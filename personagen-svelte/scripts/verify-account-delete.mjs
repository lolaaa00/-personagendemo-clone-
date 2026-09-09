#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Does "delete my account" actually delete the account's FILES? — live probe.
//
// Media lives in a PUBLIC bucket under `<userId>/…` and storage does not
// cascade from auth.users, so until 2026-09-09 a deleted account left every
// image it had generated publicly readable at a stable URL, forever. Reviewing
// the route is not proof; this drives the real endpoint on a live host with a
// throwaway account and checks the object is gone and the public URL stops
// serving it.
//
//   node scripts/verify-account-delete.mjs [--base https://host]
//
// Creates one account and one 70-byte PNG, deletes both, and cleans up whatever
// happened. Exit 0 = deletion means deletion.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
const env={};for(const l of readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')){const m=l.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);if(m)env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}
const argv=process.argv.slice(2); const bi=argv.indexOf('--base');
const SB=env.PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY, BASE=(bi>=0?argv[bi+1]:'https://honeyx.monarchstack.com').replace(/\/$/,'');
const h={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const pg=q=>fetch(`${SB}/pg/query`,{method:'POST',headers:h,body:JSON.stringify({query:q})}).then(async r=>{const t=await r.text();try{return JSON.parse(t)}catch{return t}});
const q=s=>`'${String(s).replace(/'/g,"''")}'`;
const results=[]; const check=(n,ok,d='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${n}${d?`  — ${d}`:''}`)};

const email=`e2e-del-${Date.now()}@personagen.test`, password='DelProbe!'+Math.random().toString(36).slice(2,10);
const cu=await fetch(`${SB}/auth/v1/admin/users`,{method:'POST',headers:h,body:JSON.stringify({email,password,email_confirm:true})});
const user=await cu.json(); const uid=user.id;
check('throwaway account created', cu.ok && !!uid, email);

// Put a file exactly where the app puts generated media.
const path=`${uid}/${Date.now()}-probe.png`;
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082','hex');
const up=await fetch(`${SB}/storage/v1/object/ugc-media/${path}`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'image/png'},body:png});
check('a file exists under the account prefix', up.ok, path);
const before=await pg(`select count(*)::int as n from storage.objects where split_part(name,'/',1)=${q(uid)}`);
check('storage shows it', Number(before[0].n)===1, `objects=${before[0].n}`);

// Log in through the app and delete via the REAL route.
const jar=new Map();
const login=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
for(const c of (login.headers.getSetCookie?.()??[])){const p=c.split(';')[0];const i=p.indexOf('=');if(i>0)jar.set(p.slice(0,i).trim(),p.slice(i+1).trim());}
check('logged in through the live app', login.status===200 && jar.size>0, `HTTP ${login.status}`);
const del=await fetch(`${BASE}/api/account/delete`,{method:'POST',headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}});
const delBody=await del.json().catch(()=>({}));
check('POST /api/account/delete succeeded', del.status===200 && delBody.success===true, `HTTP ${del.status} failedSteps=${JSON.stringify(delBody.failedSteps??[])}`);

const after=await pg(`select count(*)::int as n from storage.objects where split_part(name,'/',1)=${q(uid)}`);
check('THE FILE IS GONE (this is the bug that was fixed)', Number(after[0].n)===0, `objects remaining=${after[0].n}`);
const stillUser=await pg(`select count(*)::int as n from auth.users where id=${q(uid)}`);
check('the account is gone too', Number(stillUser[0].n)===0);
const pub=await fetch(`${SB}/storage/v1/object/public/ugc-media/${path}`);
check('the public URL no longer serves it', pub.status===404 || pub.status===400, `HTTP ${pub.status}`);

// Leave nothing behind whatever happened.
await pg(`delete from storage.objects where split_part(name,'/',1)=${q(uid)}`);
await fetch(`${SB}/auth/v1/admin/users/${uid}`,{method:'DELETE',headers:h});
const failed=results.filter(r=>!r).length;
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
