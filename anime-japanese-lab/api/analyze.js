export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { bvid } = req.body || {};
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) return res.status(400).json({ error: '无效的 B 站 BV 号' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: '云端尚未配置 GEMINI_API_KEY' });
  try {
    const headers = { 'User-Agent':'Mozilla/5.0 Chrome/139 Safari/537.36', 'Referer':'https://www.bilibili.com/' };
    const vr = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {headers});
    const vi = await vr.json();
    if (vi.code !== 0 || !vi.data) throw new Error('B站视频信息获取失败');
    const page = vi.data.pages?.[0] || {cid:vi.data.cid};
    const cid = page.cid;
    if (!cid) throw new Error('没有找到视频分P信息');
    const pr = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, {headers});
    const pi = await pr.json();
    const subs = pi.data?.subtitle?.subtitles || [];
    if (!subs.length) return res.status(422).json({error:'这个视频没有公开字幕，当前无法仅凭 B 站链接完成语音识别。请选择带字幕的视频。', title:vi.data.title});
    const sub = subs.find(x=>/^ja|japanese|日/i.test(`${x.lan} ${x.lan_doc}`)) || subs[0];
    let su=sub.subtitle_url; if(su?.startsWith('//')) su='https:'+su;
    const sr=await fetch(su,{headers}); const sj=await sr.json();
    const body=Array.isArray(sj.body)?sj.body:[]; if(!body.length) throw new Error('字幕内容为空');
    const slice=body.slice(0,80).map(x=>({start:x.from,end:x.to,text:x.content}));
    const prompt=`你是专业日语教师。分析视频《${vi.data.title}》的字幕。逐句保留原文和时间戳，生成平假名/片假名读音、自然中文翻译、重点单词（原词、reading、中文释义、词性）、语法讲解。不要编造字幕中不存在的内容。面向中文初中级学习者，解释简洁。只返回JSON。字幕：${JSON.stringify(slice)}`;
    const schema={type:'object',properties:{sentences:{type:'array',items:{type:'object',properties:{start:{type:'number'},end:{type:'number'},text:{type:'string'},kana:{type:'string'},translation:{type:'string'},words:{type:'array',items:{type:'object',properties:{surface:{type:'string'},reading:{type:'string'},meaning:{type:'string'},pos:{type:'string'}},required:['surface','reading','meaning']}},grammar:{type:'string'}},required:['start','end','text','kana','translation','words','grammar']}}},required:['sentences']};
    const gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0.2}})});
    const gj=await gr.json(); if(!gr.ok) throw new Error(gj.error?.message||'Gemini 分析失败');
    const out=gj.candidates?.[0]?.content?.parts?.[0]?.text; if(!out) throw new Error('Gemini 没有返回结果');
    const result=JSON.parse(out);
    return res.status(200).json({title:vi.data.title,bvid,source:sub.lan_doc||sub.lan,sentences:result.sentences||[]});
  } catch(e){ return res.status(500).json({error:e.message||'分析失败'}); }
}
