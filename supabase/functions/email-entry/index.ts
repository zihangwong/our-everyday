import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

// This is explicitly email-only access, not proof of email ownership. Only an
// administrator can enable addresses; Auth sessions and existing RLS stay intact.
export function createEmailEntryHandler({createClient,env}) {
  return async function handle(req) {
    const origin=req.headers.get('origin');
    const origins=(env('EMAIL_ENTRY_ORIGINS')||'http://127.0.0.1:4274,http://localhost:4274,https://our-everyday-1108-zihan.relaxedpansy2.chatgpt.site').split(',').map(s=>s.trim());
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'};
    if(origin&&origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&!origins.includes(origin))return reply(403,{error:'暂时不能从这个页面进入。'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{error:'请通过邮箱入口进入。'});
    try {
      const raw=await req.text();if(new TextEncoder().encode(raw).length>1024)return reply(413,{error:'请求内容过长。'});
      let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'请输入正确的邮箱。'});}
      const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
      if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))return reply(400,{error:'请输入正确的邮箱。'});
      const url=env('SUPABASE_URL'),serviceKey=env('SUPABASE_SERVICE_ROLE_KEY'),anonKey=env('SUPABASE_ANON_KEY');
      if(!url||!serviceKey||!anonKey)return reply(503,{error:'入口正在准备，请稍后再试。'});
      const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
      const admin=createClient(url,serviceKey,options);
      const gate=await admin.rpc('begin_email_entry',{p_email:email});
      if(gate.error)return reply(/EMAIL_ENTRY_LIMIT/.test(gate.error.message)?429:403,{error:/EMAIL_ENTRY_LIMIT/.test(gate.error.message)?'进入次数太频繁，请稍等一分钟。':'这个邮箱暂时不能进入，请确认拼写。'});
      if(!gate.data?.auth_user_id){
        const created=await admin.auth.admin.createUser({email,email_confirm:true});
        if(created.error&&!['email_exists','user_already_exists'].includes(created.error.code))return reply(503,{error:'暂时无法建立登录，请稍后再试。'});
      }
      // Generate and consume the link on the server. No message is sent, and no
      // service credential or one-time link is ever returned to the browser.
      const link=await admin.auth.admin.generateLink({type:'magiclink',email});
      const user=link.data?.user,hash=link.data?.properties?.hashed_token;
      if(link.error||!user?.id||!hash||String(user.email).toLowerCase()!==email)return reply(503,{error:'暂时无法建立登录，请稍后再试。'});
      const admitted=await admin.rpc('admit_email_entry',{p_email:email,p_user_id:user.id});
      if(admitted.error||admitted.data!==gate.data.diary_id)return reply(403,{error:'这个邮箱暂时不能进入该空间。'});
      const client=createClient(url,anonKey,options);
      const verified=await client.auth.verifyOtp({token_hash:hash,type:'email'});
      const session=verified.data?.session;
      if(verified.error||!session||verified.data?.user?.id!==user.id)return reply(503,{error:'登录尚未建立，请稍后重试。'});
      return reply(200,{diary_id:admitted.data,session:{access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at,token_type:'bearer'}});
    }catch{return reply(503,{error:'暂时无法进入，请稍后再试。'});}
  };
}

Deno.serve(createEmailEntryHandler({createClient,env:name=>Deno.env.get(name)}));
