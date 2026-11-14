// Passwordless credentials: only included on Dart sign-in page.
function supportsCustomerPasskeys(){
  return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
}
function base64ToBytes(value){
  const normalized=String(value).replace(/-/g,"+").replace(/_/g,"/");
  const decoded=atob(normalized+"=".repeat((4-normalized.length%4)%4));
  return Uint8Array.from(decoded,char=>char.charCodeAt(0));
}
function bytesToBase64(value){
  const bytes=new Uint8Array(value);
  let binary="";
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function registerCustomerPasskey(){
  if(!supportsCustomerPasskeys())throw new Error("هذا الجهاز أو المتصفح لا يدعم تسجيل الدخول بالبصمة.");
  const {challengeId,options}=await window.DartPlatform.apiRequest("/api/v1/auth/passkeys/register/options",{method:"POST",body:{}});
  const publicKey={
    ...options,
    challenge:base64ToBytes(options.challenge),
    user:{...options.user,id:base64ToBytes(options.user.id)},
    excludeCredentials:(options.excludeCredentials||[]).map(row=>({...row,id:base64ToBytes(row.id)})),
  };
  const passkey=await navigator.credentials.create({publicKey});
  if(!passkey)throw new Error("تم إلغاء تفعيل البصمة.");
  return window.DartPlatform.apiRequest("/api/v1/auth/passkeys/register/verify",{
    method:"POST",body:{challengeId,credential:{
      id:passkey.id,type:passkey.type,
      response:{
        clientDataJSON:bytesToBase64(passkey.response.clientDataJSON),
        attestationObject:bytesToBase64(passkey.response.attestationObject),
        transports:passkey.response.getTransports?.()||[],
      },
    }},
  });
}
async function loginCustomerPasskey(){
  if(!supportsCustomerPasskeys())throw new Error("هذا الجهاز أو المتصفح لا يدعم تسجيل الدخول بالبصمة.");
  const {challengeId,options}=await window.DartPlatform.apiRequest("/api/v1/auth/passkeys/authenticate/options",{method:"POST",body:{}});
  const passkey=await navigator.credentials.get({publicKey:{
    ...options,
    challenge:base64ToBytes(options.challenge),
    allowCredentials:(options.allowCredentials||[]).map(row=>({...row,id:base64ToBytes(row.id)})),
  }});
  if(!passkey)throw new Error("تم إلغاء تسجيل الدخول بالبصمة.");
  const result=await window.DartPlatform.apiRequest("/api/v1/auth/passkeys/authenticate/verify",{
    method:"POST",body:{challengeId,credential:{
      id:passkey.id,type:passkey.type,
      response:{
        clientDataJSON:bytesToBase64(passkey.response.clientDataJSON),
        authenticatorData:bytesToBase64(passkey.response.authenticatorData),
        signature:bytesToBase64(passkey.response.signature),
        userHandle:passkey.response.userHandle?bytesToBase64(passkey.response.userHandle):null,
      },
    }},
  });
  return window.DartPlatform.finishPasswordlessPasskey(result);
}


// Email OTP and opt-in WebAuthn interface within Dart's existing auth page.
function showCustomerOtpStep(form,purpose,challenge) {
  form.dataset.otpPurpose=purpose;
  form.dataset.otpChallenge=String(challenge.challengeId||"");
  form.dataset.otpPending="1";
  let panel=form.querySelector("[data-dart-otp-panel]");
  if(!panel) {
    panel=document.createElement("section");
    panel.className="dart-auth-otp-panel";
    panel.setAttribute("data-dart-otp-panel","");
    panel.innerHTML=[
      '<h2 class="dart-auth-otp-heading">OTP الخاص بك</h2>',
      '<p class="dart-auth-otp-message" data-otp-destination></p>',
      '<div class="dart-auth-otp-inputs" role="group" aria-label="رمز التحقق">',
      ...Array.from({length:6},(_,index)=>'<input class="dart-auth-otp-digit" type="text" inputmode="numeric" pattern="[0-9]" maxlength="6" autocomplete="'+(index===0?'one-time-code':'off')+'" aria-label="رقم '+(index+1)+' من رمز التحقق" required>'),
      '</div>',
      '<button type="submit" class="btn enter-btn">تأكيد الكود</button>',
      '<button type="button" class="dart-auth-otp-other" data-otp-other>اختيار طريقة أخرى</button>',
      '<p class="dart-auth-otp-status" data-otp-status role="status" aria-live="polite"></p>',
    ].join("");
    form.appendChild(panel);
    const digits=Array.from(panel.querySelectorAll(".dart-auth-otp-digit"));
    digits.forEach((input,index)=>{
      input.addEventListener("input",()=>{
        const value=String(input.value||"").replace(/\D/g,"");
        if(value.length>1){
          for(let i=0;i<Math.min(6-index,value.length);i++)digits[index+i].value=value[i];
          digits[Math.min(5,index+value.length)]?.focus();
        } else {
          input.value=value;
          if(value&&index<5)digits[index+1].focus();
        }
      });
      input.addEventListener("keydown",event=>{
        if(event.key==="Backspace"&&!input.value&&index>0)digits[index-1].focus();
      });
      input.addEventListener("paste",event=>{
        const code=event.clipboardData?.getData("text")?.replace(/\D/g,"");
        if(!code||code.length<2)return;
        event.preventDefault();
        Array.from(code.slice(0,6)).forEach((digit,i)=>{digits[i].value=digit;});
        digits[Math.min(5,code.length-1)].focus();
      });
    });
    panel.querySelector("[data-otp-other]").addEventListener("click",async()=>{
      if(!supportsCustomerPasskeys()){
        panel.querySelector("[data-otp-status]").textContent="واتساب سيتوفر لاحقًا. استخدم الكود المرسل بالبريد الإلكتروني.";
        return;
      }
      try{
        await loginCustomerPasskey();
        location.assign(window.DartPlatform.requestedAuthDestination());
      }catch(error){
        panel.querySelector("[data-otp-status]").textContent=error?.message||"تعذر تسجيل الدخول بالبصمة.";
      }
    });
  }
  Array.from(form.children).forEach(child=>{
    if(child!==panel)child.classList.add("dart-auth-original-hidden");
  });
  panel.hidden=false;
  const recipient=String(challenge.email||"").trim();
  panel.querySelector("[data-otp-destination]").textContent=recipient
    ?"قم بإدخال رمز التحقق الذي أرسلناه إلى بريدك الإلكتروني "+recipient
    :"قم بإدخال رمز التحقق الذي أرسلناه إلى البريد الإلكتروني المسجل بحسابك.";
  panel.querySelector("[data-otp-status]").textContent="الرمز صالح لمدة 5 دقائق. تأكد من البريد الوارد والرسائل غير المرغوبة.";
  panel.querySelector(".dart-auth-otp-digit")?.focus();
}
async function submitCustomerOtpStep(form,purpose){
  if(form.dataset.otpVerifying==="1")return;
  const panel=form.querySelector("[data-dart-otp-panel]");
  const digits=Array.from(panel.querySelectorAll(".dart-auth-otp-digit"));
  const code=digits.map(input=>input.value).join("");
  const status=panel.querySelector("[data-otp-status]");
  if(!/^\d{6}$/.test(code)){status.textContent="أدخل الأرقام الستة للكود.";return;}
  form.dataset.otpVerifying="1";
  const submit=panel.querySelector('[type="submit"]');
  submit.disabled=true;
  status.textContent="جارٍ التحقق من الرمز...";
  try{
    if(purpose==="register")await window.DartPlatform.verifyRegistrationOtp(form.dataset.otpChallenge,code);
    else await window.DartPlatform.verifyLoginOtp(form.dataset.otpChallenge,code);
    form.dataset.otpPending="0";
    await offerCustomerPasskeyEnrollment();
  }catch(error){
    status.textContent=error?.message||"تعذر التحقق من الرمز.";
    digits.forEach(input=>input.value="");
    digits[0]?.focus();
  }finally{
    delete form.dataset.otpVerifying;
    submit.disabled=false;
  }
}
async function offerCustomerPasskeyEnrollment(){
  if(!supportsCustomerPasskeys()){
    location.assign(window.DartPlatform.requestedAuthDestination());return;
  }
  const overlay=document.createElement("div");
  overlay.className="dart-passkey-optin-backdrop";
  overlay.innerHTML=[
    '<div class="dart-passkey-optin-card" role="dialog" aria-modal="true" aria-labelledby="dartPasskeyOptinTitle">',
    '<div class="dart-passkey-optin-icon" aria-hidden="true">◎</div>',
    '<h2 id="dartPasskeyOptinTitle">الدخول بالبصمة أو الوجه</h2>',
    '<p>تقدر تسجّل الدخول في المرات الجاية ببصمة الإصبع أو الوجه بدل كود الإيميل. التفعيل اختياري.</p>',
    '<button type="button" class="dart-passkey-optin-enable">تفعيل الآن</button>',
    '<button type="button" class="dart-passkey-optin-skip">لاحقًا</button>',
    '<p data-passkey-optin-status role="status" aria-live="polite"></p>',
    '</div>',
  ].join("");
  document.body.appendChild(overlay);
  const finish=()=>{overlay.remove();location.assign(window.DartPlatform.requestedAuthDestination());};
  overlay.querySelector(".dart-passkey-optin-skip").addEventListener("click",finish);
  overlay.querySelector(".dart-passkey-optin-enable").addEventListener("click",async()=>{
    const button=overlay.querySelector(".dart-passkey-optin-enable");
    button.disabled=true;
    const status=overlay.querySelector("[data-passkey-optin-status]");
    status.textContent="جاري تفعيل البصمة...";
    try{
      await registerCustomerPasskey();
      status.textContent="تم تفعيل تسجيل الدخول بالبصمة.";
      finish();
    }catch(error){
      status.textContent=error?.message||"تعذر تفعيل البصمة. يمكنك المحاولة لاحقًا.";
    }finally{button.disabled=false;}
  });
}
function bindCustomerPasskeyLogin(){
  const button=document.getElementById("dartPasskeyLogin");
  if(!button)return;
  button.hidden=!supportsCustomerPasskeys();
  button.addEventListener("click",async()=>{
    if(button.disabled)return;
    button.disabled=true;
    try{
      await loginCustomerPasskey();
      location.assign(window.DartPlatform.requestedAuthDestination());
    }catch(error){
      const form=document.getElementById("loginForm");
      const message=form?.querySelector("[data-otp-status]");
      if(message)message.textContent=error?.message||"تعذر الدخول بالبصمة.";
      else if(form) {
        const status=form.querySelector(".form-status")||document.createElement("p");
        if(!status.isConnected){status.className="form-status";form.appendChild(status);}
        status.textContent=error?.message||"تعذر الدخول بالبصمة.";
      }
    }finally{button.disabled=false;}
  });
}
