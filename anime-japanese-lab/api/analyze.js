const FREE_MODELS = [
  'THUDM/GLM-Z1-9B-0414',
  'tencent/Hunyuan-MT-7B'
];

function stripFence(s='') {
  return s.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
}

async function callSiliconFlow(apiKey, prompt) {
  let lastError = '';
  for (const model of FREE_MODELS) {
    try {
      const r = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是专业日语老师。必须只输出合法 JSON，不要输出 Markdown。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 7000,
          response_format: { type: 'json_object' }
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || j?.error?.message || `HTTP ${r.status}`);
      const text = j?.choices?.[0]?.message?.content;
      if (!text) throw new Error('模型没有返回内容');
      const parsed = JSON.parse(stripFence(text));
      return { parsed, model };
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }
  throw new Error(`免费模型均调用失败：${lastError}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { bvid } = req.body || {};
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) return res.status(400).json({ error: '无效的 B 站 BV 号' });
  if (!process.env.SILICONFLOW_API_KEY) return res.status(500).json({ error: '云端尚未配置 SILICONFLOW_API_KEY' });

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    };

    const vr = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers });
    const vi = await vr.json();
    if (vi.code !== 0 || !vi.data) throw new Error('B站视频信息获取失败');

    const page = vi.data.pages?.[0] || { cid: vi.data.cid };
    const cid = page.cid;
    if (!cid) throw new Error('没有找到视频分P信息');

    const pr = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, { headers });
    const pi = await pr.json();
    const subs = pi.data?.subtitle?.subtitles || [];

    if (!subs.length) {
      return res.status(422).json({
        error: '这个视频没有可匿名读取的公开字幕。AI 已接通，但当前还缺“B站音频→免费语音识别”的兜底链路。',
        title: vi.data.title,
        bvid,
        stage: 'subtitle_missing'
      });
    }

    const sub = subs.find(x => /^ja|japanese|日/i.test(`${x.lan || ''} ${x.lan_doc || ''}`)) || subs[0];
    let su = sub.subtitle_url;
    if (su?.startsWith('//')) su = 'https:' + su;
    const sr = await fetch(su, { headers });
    const sj = await sr.json();
    const body = Array.isArray(sj.body) ? sj.body : [];
    if (!body.length) throw new Error('字幕内容为空');

    const slice = body.slice(0, 80).map(x => ({ start: x.from, end: x.to, text: x.content }));
    const prompt = `请把下面的日语/中文字幕整理成日语学习卡片。要求：\n1. 保留 start/end 时间戳和 text 原文；\n2. kana：为日语原文标注自然的平假名/片假名读音；\n3. translation：自然简体中文翻译；\n4. words：列出重点词，字段 surface, reading, meaning, pos；\n5. grammar：简洁解释本句最值得学习的语法；\n6. 不要编造字幕里没有的信息；\n7. 输出格式必须是 {"sentences":[...]}。\n视频标题：${vi.data.title}\n字幕：${JSON.stringify(slice)}`;

    const { parsed, model } = await callSiliconFlow(process.env.SILICONFLOW_API_KEY, prompt);
    const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : [];
    if (!sentences.length) throw new Error('AI 返回结果中没有 sentences');

    return res.status(200).json({
      title: vi.data.title,
      bvid,
      source: sub.lan_doc || sub.lan,
      model,
      costMode: 'free-first',
      sentences
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || '分析失败' });
  }
}
