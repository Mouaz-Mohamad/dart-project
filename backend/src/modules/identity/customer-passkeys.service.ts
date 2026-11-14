// DART | Passwordless WebAuthn (discoverable ES256 passkeys; no biometric data is stored).
import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import type { AuthenticatedAccount, IssuedSession, RequestMetadata } from "./identity.types.js";
import type { IdentityService } from "./identity.service.js";

function deny(): never { throw new AppError(400,"PASSKEY_INVALID","The passkey request is invalid or expired"); }
function base64url(value:unknown,max=32768):Buffer {
  if(typeof value!=="string"||!value||value.length>max*2||!/^[A-Za-z0-9_-]+$/.test(value))return deny();
  const result=Buffer.from(value,"base64url");
  if(!result.length||result.length>max||result.toString("base64url")!==value)return deny();
  return result;
}
function plain(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return deny();
  return value as Record<string,unknown>;
}
function sha256(bytes:Buffer):Buffer{return createHash("sha256").update(bytes).digest();}

// Only definite-length CBOR forms needed by the standard WebAuthn "none" attestation
// and COSE P-256 public keys are accepted. Bounds/depth/duplicate checks are fail-closed.
class CborReader {
  private offset=0;
  constructor(private readonly data:Buffer){}
  position():number{return this.offset;}
  private take(n:number):Buffer{
    if(n<0||n>65536||this.offset+n>this.data.length)return deny();
    const bytes=this.data.subarray(this.offset,this.offset+n);this.offset+=n;return bytes;
  }
  private count(ai:number):number{
    if(ai<24)return ai;
    if(ai===24)return this.take(1).readUInt8(0);
    if(ai===25)return this.take(2).readUInt16BE(0);
    if(ai===26)return this.take(4).readUInt32BE(0);
    if(ai===27){
      const value=this.take(8).readBigUInt64BE(0);
      if(value>BigInt(65536))return deny();
      return Number(value);
    }
    return deny();
  }
  read(depth=0):unknown {
    if(depth>15)return deny();
    const head=this.take(1).readUInt8(0),major=head>>>5,ai=head&31;
    if(major===7){if(ai===20)return false;if(ai===21)return true;if(ai===22)return null;return deny();}
    const size=this.count(ai);
    if(major===0)return size;
    if(major===1)return -1-size;
    if(major===2)return this.take(size);
    if(major===3)return this.take(size).toString("utf8");
    if(major===4){if(size>256)return deny();return Array.from({length:size},()=>this.read(depth+1));}
    if(major===5){
      if(size>256)return deny();
      const map=new Map<number|string,unknown>();
      for(let i=0;i<size;i++){
        const key=this.read(depth+1);
        if(typeof key!=="string"&&typeof key!=="number")return deny();
        if(map.has(key))return deny();
        map.set(key,this.read(depth+1));
      }
      return map;
    }
    return deny();
  }
}
function checks(clientDataValue:unknown,type:"webauthn.create"|"webauthn.get",challenge:string,origin:string):Buffer {
  const bytes=base64url(clientDataValue,8192);
  let data:Record<string,unknown>;
  try{data=plain(JSON.parse(bytes.toString("utf8")));}catch{return deny();}
  if(data.type!==type||data.challenge!==challenge||data.origin!==origin||data.crossOrigin===true)return deny();
  return bytes;
}
function authData(bytes:Buffer,rpId:string,needsCredential:boolean):{flags:number;counter:number;id?:string;key?:Buffer}{
  if(bytes.length<37||bytes.length>16384)return deny();
  if(!bytes.subarray(0,32).equals(sha256(Buffer.from(rpId,"utf8"))))return deny();
  const flags=bytes[32]!,counter=bytes.readUInt32BE(33);
  if(!(flags&0x01)||!(flags&0x04))return deny(); // User presence AND verification required
  if(!needsCredential)return {flags,counter};
  if(!(flags&0x40)||bytes.length<55)return deny();
  const idSize=bytes.readUInt16BE(53);
  if(idSize<16||idSize>2048||bytes.length<55+idSize)return deny();
  const id=bytes.subarray(55,55+idSize).toString("base64url");
  const keyStart=55+idSize;
  const decoder=new CborReader(bytes.subarray(keyStart));
  const cose=decoder.read();
  if(!(cose instanceof Map)||cose.get(1)!==2||cose.get(3)!==-7||cose.get(-1)!==1)return deny();
  const x=cose.get(-2),y=cose.get(-3);
  if(!Buffer.isBuffer(x)||!Buffer.isBuffer(y)||x.length!==32||y.length!==32)return deny();
  let publicKey:Buffer;
  try{
    const key=createPublicKey({key:{kty:"EC",crv:"P-256",x:x.toString("base64url"),y:y.toString("base64url")},format:"jwk"});
    publicKey=key.export({type:"spki",format:"der"}) as Buffer;
  }catch{return deny();}
  return {flags,counter,id,key:publicKey};
}
function rpFromOrigin(origin:string,allowedOrigins:string[]):{rpID:string;origin:string}{
  if(!allowedOrigins.includes(origin))throw new AppError(403,"PASSKEY_ORIGIN_NOT_ALLOWED","The website origin is not approved");
  let parsed:URL;
  try{parsed=new URL(origin);}catch{return deny();}
  if(parsed.origin!==origin||parsed.username||parsed.password||parsed.pathname!=="/"&&parsed.pathname!=="")return deny();
  const localhost=parsed.hostname==="localhost"||parsed.hostname==="127.0.0.1";
  if(parsed.protocol!=="https:"&&!(localhost&&parsed.protocol==="http:"))return deny();
  const rpID=parsed.hostname==="www.dartofficial.com"?"dartofficial.com":parsed.hostname;
  return {rpID,origin};
}
interface Challenge {
  id:string;customer_user_id:string|null;session_id:string|null;action:string;
  challenge:string;rp_id:string;expected_origin:string;expires_at:Date;consumed_at:Date|null;
}
interface CredentialRow {
  credential_id:string;customer_user_id:string;public_key_spki:Buffer;sign_counter:string;
}
export class CustomerPasskeyService {
  constructor(
    private readonly pool:Pool,
    private readonly identity:IdentityService,
    private readonly config:Pick<AppConfig,"corsOrigins">,
  ){}
  private async consume(challengeId:string,action:"register"|"authenticate"):Promise<Challenge>{
    const result=await this.pool.query<Challenge>(
      "UPDATE customer_passkey_challenges SET consumed_at=now() WHERE id=$1 AND action=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING *",
      [challengeId,action],
    );
    if(!result.rows[0])return deny();
    return result.rows[0];
  }
  private async requireRecentVerification(account:AuthenticatedAccount):Promise<void>{
    if(account.accountType!=="customer")throw new AppError(403,"CUSTOMER_ONLY","Customer account required");
    const result=await this.pool.query<{allowed:boolean}>(
      "SELECT EXISTS(SELECT 1 FROM customer_verified_sessions v JOIN sessions s ON s.id=v.session_id JOIN users u ON u.id=v.customer_user_id WHERE v.session_id=$1 AND v.customer_user_id=$2 AND v.method='email_otp' AND v.verified_at>now()-interval '15 minutes' AND s.revoked_at IS NULL AND s.expires_at>now() AND u.email_verified_at IS NOT NULL AND u.status='active' AND u.deleted_at IS NULL) AS allowed",
      [account.sessionId,account.userId],
    );
    if(!result.rows[0]?.allowed)throw new AppError(403,"FRESH_EMAIL_VERIFICATION_REQUIRED","Verify your email again before adding a passkey");
  }
  async registrationOptions(account:AuthenticatedAccount,origin:string){
    await this.requireRecentVerification(account);
    const {rpID}=rpFromOrigin(origin,this.config.corsOrigins);
    const user=await this.pool.query<{email:string;name:string}>(
      "SELECT u.email,c.full_name AS name FROM users u JOIN customers c ON c.user_id=u.id WHERE u.id=$1 AND u.account_type='customer' AND u.email_verified_at IS NOT NULL",
      [account.userId],
    );
    if(!user.rows[0])throw new AppError(403,"VERIFIED_EMAIL_REQUIRED","A verified email is required");
    const known=await this.pool.query<{credential_id:string;transports:string[]}>(
      "SELECT credential_id,transports FROM customer_passkey_credentials WHERE customer_user_id=$1",[account.userId],
    );
    const challenge=randomBytes(32).toString("base64url"),id=randomUUID();
    await this.pool.query(
      "INSERT INTO customer_passkey_challenges(id,customer_user_id,session_id,action,challenge,rp_id,expected_origin,expires_at) VALUES ($1,$2,$3,'register',$4,$5,$6,now()+interval '3 minutes')",
      [id,account.userId,account.sessionId,challenge,rpID,origin],
    );
    const userId=Buffer.from(account.userId.replace(/-/g,""),"hex").toString("base64url");
    return {challengeId:id,options:{
      challenge,rp:{name:"Dart | For you",id:rpID},
      user:{id:userId,name:user.rows[0].email,displayName:user.rows[0].name},
      pubKeyCredParams:[{type:"public-key",alg:-7}],
      timeout:120000,attestation:"none",
      authenticatorSelection:{residentKey:"required",requireResidentKey:true,userVerification:"required"},
      excludeCredentials:known.rows.map(row=>({type:"public-key",id:row.credential_id,transports:row.transports})),
    }};
  }
  async register(account:AuthenticatedAccount,challengeId:string,credential:Record<string,unknown>){
    await this.requireRecentVerification(account);
    const challenge=await this.consume(challengeId,"register");
    if(challenge.customer_user_id!==account.userId||challenge.session_id!==account.sessionId)return deny();
    const response=plain(credential.response);
    checks(response.clientDataJSON,"webauthn.create",challenge.challenge,challenge.expected_origin);
    const attested=base64url(response.attestationObject,16384);
    const decoder=new CborReader(attested);
    const object=decoder.read();
    if(!(object instanceof Map)||decoder.position()!==attested.length||object.get("fmt")!=="none")return deny();
    const stmt=object.get("attStmt"),bytes=object.get("authData");
    if(!(stmt instanceof Map)||stmt.size!==0||!Buffer.isBuffer(bytes))return deny();
    const parsed=authData(bytes,challenge.rp_id,true);
    if(!parsed.id||!parsed.key||parsed.id!==credential.id||credential.type!=="public-key")return deny();
    const transports=Array.isArray(response.transports)
      ? response.transports.filter((v):v is string=>typeof v==="string"&&["internal","usb","ble","nfc","hybrid","smart-card"].includes(v)).slice(0,6)
      : [];
    await this.pool.query(
      "INSERT INTO customer_passkey_credentials(credential_id,customer_user_id,public_key_spki,sign_counter,transports) VALUES ($1,$2,$3,$4,$5)",
      [parsed.id,account.userId,parsed.key,parsed.counter,transports],
    );
    return {registered:true};
  }
  async authenticationOptions(origin:string){
    const {rpID}=rpFromOrigin(origin,this.config.corsOrigins);
    const challenge=randomBytes(32).toString("base64url"),id=randomUUID();
    await this.pool.query(
      "INSERT INTO customer_passkey_challenges(id,action,challenge,rp_id,expected_origin,expires_at) VALUES ($1,'authenticate',$2,$3,$4,now()+interval '3 minutes')",
      [id,challenge,rpID,origin],
    );
    // Discoverable passkeys avoid leaking registered credential identifiers for a guessed phone.
    return {challengeId:id,options:{challenge,rpId:rpID,timeout:120000,userVerification:"required",allowCredentials:[]}};
  }
  async authenticate(challengeId:string,credential:Record<string,unknown>,meta:RequestMetadata):Promise<IssuedSession>{
    const challenge=await this.consume(challengeId,"authenticate");
    if(credential.type!=="public-key"||typeof credential.id!=="string")return deny();
    const response=plain(credential.response);
    const clientData=checks(response.clientDataJSON,"webauthn.get",challenge.challenge,challenge.expected_origin);
    const bytes=base64url(response.authenticatorData,8192);
    const parsed=authData(bytes,challenge.rp_id,false);
    const found=await this.pool.query<CredentialRow>(
      "SELECT k.credential_id,k.customer_user_id,k.public_key_spki,k.sign_counter::text FROM customer_passkey_credentials k JOIN users u ON u.id=k.customer_user_id WHERE k.credential_id=$1 AND u.account_type='customer' AND u.status='active' AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL",
      [credential.id],
    );
    const row=found.rows[0];if(!row)return deny();
    const userHandle=response.userHandle;
    if(userHandle!==null&&userHandle!==undefined&&userHandle!==""){
      const uuid=base64url(userHandle,128).toString("hex");
      if(uuid!==row.customer_user_id.replace(/-/g,""))return deny();
    }
    const sig=base64url(response.signature,1024);
    let valid=false;
    try {
      const key=createPublicKey({key:row.public_key_spki,format:"der",type:"spki"});
      valid=verifySignature("sha256",Buffer.concat([bytes,sha256(clientData)]),key,sig);
    }catch{return deny();}
    if(!valid)return deny();
    const previous=Number(row.sign_counter);
    if(previous>0&&parsed.counter>0&&parsed.counter<=previous)return deny();
    await this.pool.query(
      "UPDATE customer_passkey_credentials SET sign_counter=GREATEST(sign_counter,$2),last_used_at=now() WHERE credential_id=$1",
      [row.credential_id,parsed.counter],
    );
    return this.identity.loginLinkedSocialCustomer(row.customer_user_id,meta,"passkey");
  }
}
