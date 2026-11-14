import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount, IssuedSession } from "../src/modules/identity/identity.types.js";
import { CustomerPasskeyService } from "../src/modules/identity/customer-passkeys.service.js";

const origin="https://www.dartofficial.com",rpId="dartofficial.com";
const userId="123e4567-e89b-42d3-a456-426614174002";
const sessionId="123e4567-e89b-42d3-a456-426614174000";
const account={accountType:"customer",userId,sessionId} as AuthenticatedAccount;
function length(major:number,value:number):Buffer{
  if(value<24)return Buffer.from([(major<<5)|value]);
  if(value<256)return Buffer.from([(major<<5)|24,value]);
  const b=Buffer.alloc(3);b[0]=(major<<5)|25;b.writeUInt16BE(value,1);return b;
}
function cbor(v:unknown):Buffer{
  if(Buffer.isBuffer(v))return Buffer.concat([length(2,v.length),v]);
  if(typeof v==="string"){const b=Buffer.from(v);return Buffer.concat([length(3,b.length),b]);}
  if(typeof v==="number")return length(v<0?1:0,v<0?-v-1:v);
  if(v instanceof Map){
    return Buffer.concat([length(5,v.size),...[...v.entries()].flatMap(([k,val])=>[cbor(k),cbor(val)])]);
  }
  throw new Error("Unsupported CBOR test value");
}
function encoded(v:Buffer):string{return v.toString("base64url");}
function client(type:string,challenge:string):Buffer{return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));}
function signedPrefix(flags:number,counter:number):Buffer{
  const count=Buffer.alloc(4);count.writeUInt32BE(counter);
  return Buffer.concat([createHash("sha256").update(rpId).digest(),Buffer.from([flags]),count]);
}

describe("WebAuthn ES256 end-to-end cryptographic verification",()=>{
  it("accepts a genuine registration and signature; rejects tampering and replay",async()=>{
    const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const jwk=publicKey.export({format:"jwk"}) as {x:string;y:string};
    const id=encoded(randomBytes(32)),keyMap=new Map<unknown,unknown>([
      [1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,"base64url")],[-3,Buffer.from(jwk.y,"base64url")],
    ]);
    const challenges=new Map<string,Record<string,unknown>>();
    let credential:{credential_id:string;customer_user_id:string;public_key_spki:Buffer;sign_counter:string}|null=null;
    const pool={query:vi.fn(async(sql:string,args:unknown[]=[])=>{
      if(sql.includes("SELECT EXISTS(SELECT 1 FROM customer_verified_sessions"))return {rows:[{allowed:true}]};
      if(sql.includes("SELECT u.email,c.full_name"))return {rows:[{email:"verified@example.test",name:"Verified customer"}]};
      if(sql.includes("SELECT credential_id,transports FROM customer_passkey_credentials"))return {rows:[]};
      if(sql.includes("INSERT INTO customer_passkey_challenges")){
        const [id,one,two,three,four,five]=args;
        if(sql.includes("'register'"))challenges.set(String(id),{id,customer_user_id:one,session_id:two,action:"register",challenge:three,rp_id:four,expected_origin:five,consumed_at:null,expires_at:new Date(Date.now()+300000)});
        else challenges.set(String(id),{id,customer_user_id:null,session_id:null,action:"authenticate",challenge:one,rp_id:two,expected_origin:three,consumed_at:null,expires_at:new Date(Date.now()+300000)});
        return {rows:[]};
      }
      if(sql.includes("UPDATE customer_passkey_challenges SET consumed_at")){
        const row=challenges.get(String(args[0]));
        if(!row||row.consumed_at||row.action!==args[1])return {rows:[]};
        row.consumed_at=new Date();
        return {rows:[row]};
      }
      if(sql.includes("INSERT INTO customer_passkey_credentials")){
        credential={credential_id:String(args[0]),customer_user_id:String(args[1]),public_key_spki:args[2] as Buffer,sign_counter:String(args[3])};
        return {rows:[]};
      }
      if(sql.includes("SELECT k.credential_id"))return {rows:credential?[credential]:[]};
      if(sql.includes("UPDATE customer_passkey_credentials SET sign_counter")){
        if(credential)credential.sign_counter=String(args[1]);
        return {rows:[]};
      }
      throw new Error("Unexpected SQL: "+sql);
    })};
    const session={account,sessionToken:"synthetic",csrfToken:"synthetic",expiresAt:new Date(Date.now()+86400000)} as IssuedSession;
    const identity={loginLinkedSocialCustomer:vi.fn().mockResolvedValue(session)};
    const service=new CustomerPasskeyService(pool as unknown as Pool,identity as unknown as IdentityService,{corsOrigins:[origin]});
    const registration=await service.registrationOptions(account,origin);
    const idBytes=Buffer.from(id,"base64url"),size=Buffer.alloc(2);size.writeUInt16BE(idBytes.length);
    const auth=Buffer.concat([signedPrefix(0x45,0),Buffer.alloc(16),size,idBytes,cbor(keyMap)]);
    const attestation=cbor(new Map<unknown,unknown>([["fmt","none"],["attStmt",new Map()],["authData",auth]]));
    expect(await service.register(account,registration.challengeId,{
      id,type:"public-key",response:{clientDataJSON:encoded(client("webauthn.create",registration.options.challenge)),attestationObject:encoded(attestation)},
    })).toEqual({registered:true});
    const assertion=await service.authenticationOptions(origin);
    const authData=signedPrefix(0x05,1);
    const payload=client("webauthn.get",assertion.options.challenge);
    const signature=sign("sha256",Buffer.concat([authData,createHash("sha256").update(payload).digest()]),privateKey);
    const response={id,type:"public-key",response:{
      clientDataJSON:encoded(payload),authenticatorData:encoded(authData),
      signature:encoded(signature),userHandle:null,
    }};
    expect(await service.authenticate(assertion.challengeId,response,{requestId:"test"})).toEqual(session);
    expect(identity.loginLinkedSocialCustomer).toHaveBeenCalledWith(userId,{requestId:"test"},"passkey");
    await expect(service.authenticate(assertion.challengeId,response,{requestId:"replay"})).rejects.toMatchObject({code:"PASSKEY_INVALID"});
    const tampered=await service.authenticationOptions(origin);
    const wrongSig={...response,response:{...response.response,
      clientDataJSON:encoded(client("webauthn.get",tampered.options.challenge)),
      signature:encoded(randomBytes(70)),
    }};
    await expect(service.authenticate(tampered.challengeId,wrongSig,{requestId:"bad"}))
      .rejects.toMatchObject({code:"PASSKEY_INVALID"});
  });
});
