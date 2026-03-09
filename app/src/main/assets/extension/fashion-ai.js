/**
 * fashion-ai.js — AI Storyboard Generator for Fashion Mode
 * Sends prompts to Gemini/OpenAI to create fashion-specific storyboards
 * Depends on: fashion-prompt.js (window.__fashionPrompt)
 */
(function () {
    'use strict';

    /* ════════════════════════════════════════════
       SYSTEM PROMPT — Fashion UGC Director
       ════════════════════════════════════════════ */
    const SYSTEM_PROMPT = `คุณเป็นผู้กำกับวิดีโอ TikTok สายแฟชั่น ที่เชี่ยวชาญสร้างคอนเทนต์สไตล์ UGC (User Generated Content) 

หน้าที่ของคุณ:
1. สร้าง storyboard สำหรับรีวิวเสื้อผ้า/แฟชั่น แนว UGC ธรรมชาติเหมือนจริง
2. เน้นท่าทางธรรมชาติ ไม่เป็นทางการ เหมือนคนจริงถ่ายเองด้วยมือถือ
3. ทุก prompt ต้องให้ผลลัพธ์เหมือนรีวิวจริง ไม่ใช่ภาพถ่ายแฟชั่นระดับสตูดิโอ
4. ใส่รายละเอียดเสื้อผ้าให้ชัดเจนในทุก scene
5. ใช้มุมกล้องแบบ selfie / มือถือ / UGC เป็นหลัก

กฎสำคัญ:
- ห้ามใช้คำว่า "professional", "editorial", "high fashion", "studio lighting"
- ใช้คำว่า "real person", "natural", "UGC", "phone camera", "authentic" แทน
- ทุก scene ต้องมี image_prompt (สำหรับสร้างภาพ) และ video_prompt (สำหรับสร้างวิดีโอจากภาพ)
- ตอบเป็น JSON เท่านั้น`;

    /* ════════════════════════════════════════════
       GENERATE STORYBOARD — Main entry point
       ════════════════════════════════════════════ */
    /**
     * @param {Object} config
     * @param {string} config.subMode - spin|runway|dance|lookbook|shop|tryon
     * @param {string} config.clothingDesc - clothing description
     * @param {string} config.modelGender - female|male
     * @param {string} config.modelDesc - optional model description
     * @param {string} config.location - location key
     * @param {string} config.tone - tone key
     * @param {number} config.sceneCount - number of scenes
     * @param {string} config.productName - product name for caption
     * @param {string} config.extraDetails - extra user instructions
     * @param {number} config.scriptCount - number of script variations (default 3)
     * @returns {Promise<Array>} array of storyboard options
     */
    async function generateStoryboard(config) {
        const FP = window.__fashionPrompt;
        if (!FP) throw new Error('fashion-prompt.js not loaded');

        const sceneCount = config.sceneCount || _getDefaultScenes(config.subMode);
        const scriptCount = config.scriptCount || 3;

        const subModeNames = {
            spin: 'หมุนโชว์ชุด (Spin & Pose)',
            runway: 'เดินแบบ (Runway Walk)',
            dance: 'เต้นโชว์ชุด (Dance & Style)',
            lookbook: 'Lookbook (หลายชุด)',
            shop: 'ในร้าน (In-Shop)',
            tryon: 'ลองชุด (Virtual Try-On)'
        };

        const userPrompt = `สร้าง storyboard ${scriptCount} แบบ สำหรับวิดีโอ TikTok รีวิวเสื้อผ้า

โหมด: ${subModeNames[config.subMode] || config.subMode}
เสื้อผ้า: ${config.clothingDesc}
นางแบบ: ${config.modelGender === 'male' ? 'ผู้ชาย' : 'ผู้หญิง'}${config.modelDesc ? ' (' + config.modelDesc + ')' : ''}
สถานที่: ${FP.LOCATIONS[config.location] || config.location}
โทนภาพ: ${FP.TONES[config.tone] || config.tone}
จำนวนฉาก: ${sceneCount}
${config.extraDetails ? 'รายละเอียดเพิ่มเติม: ' + config.extraDetails : ''}

ตอบเป็น JSON format:
{
  "scripts": [
    {
      "title": "ชื่อ script (ภาษาไทย)",
      "concept": "แนวคิดรวมของ script (1 บรรทัด)",
      "scenes": [
        {
          "scene": 1,
          "scene_name": "ชื่อฉาก",
          "image_prompt": "English prompt for image generation (UGC style, natural, real person...)",
          "video_prompt": "English prompt for video generation from the image",
          "caption_th": "คำบรรยายฉากนี้ภาษาไทย"
        }
      ]
    }
  ]
}`;

        const apiKey = _getGeminiKey();
        if (!apiKey) {
            // Fallback: use fashion-prompt.js templates
            console.log('[Fashion-AI] No API key, using template fallback');
            return _templateFallback(config, sceneCount, scriptCount);
        }

        try {
            const response = await _callGeminiAPI(apiKey, SYSTEM_PROMPT, userPrompt);
            const parsed = _parseJSON(response);
            if (parsed && parsed.scripts && parsed.scripts.length > 0) {
                console.log('[Fashion-AI] Generated ' + parsed.scripts.length + ' scripts via AI');
                return parsed.scripts;
            }
        } catch (err) {
            console.warn('[Fashion-AI] AI call failed, using fallback:', err.message);
        }

        // Fallback to templates
        return _templateFallback(config, sceneCount, scriptCount);
    }

    /* ════════════════════════════════════════════
       TEMPLATE FALLBACK — when no API key or AI fails
       ════════════════════════════════════════════ */
    function _templateFallback(config, sceneCount, scriptCount) {
        const FP = window.__fashionPrompt;
        var scripts = [];

        var concepts = {
            spin: ['หมุนตัวโชว์ชุดเต็มๆ', 'โพสท่าแบบ OOTD', 'รีวิวชุดแบบเร็วๆ ปังๆ'],
            runway: ['เดินแบบสุดปัง', 'Fashion Show ส่วนตัว', 'เดินแบบ + โชว์ดีเทล'],
            dance: ['เต้นสนุกๆ โชว์ชุด', 'TikTok Dance Challenge', 'ขยับตัวตาม Beat'],
            lookbook: ['Lookbook คอลเลคชั่นใหม่', 'Mix & Match ชุดสวย', '5 Looks ที่ต้องมี'],
            shop: ['พาช้อปในร้าน', 'ลองชุดในร้าน', 'Shopping Haul'],
            tryon: ['ลองชุดใหม่', 'Virtual Try-On รีวิว', 'ชุดนี้ใส่แล้วเป็นไง']
        };

        for (var s = 0; s < scriptCount; s++) {
            var storyboard = FP.buildStoryboard({
                subMode: config.subMode,
                clothingDesc: config.clothingDesc,
                modelGender: config.modelGender,
                modelDesc: config.modelDesc,
                location: config.location,
                tone: config.tone,
                sceneCount: sceneCount
            });

            var conceptList = concepts[config.subMode] || concepts.spin;
            scripts.push({
                title: conceptList[s % conceptList.length],
                concept: conceptList[s % conceptList.length] + ' — สไตล์ UGC ธรรมชาติ',
                scenes: storyboard.scenes.map(function (sc) {
                    return {
                        scene: sc.index,
                        scene_name: sc.sceneName,
                        image_prompt: sc.imagePrompt,
                        video_prompt: sc.videoPrompt,
                        caption_th: sc.sceneName
                    };
                })
            });
        }

        console.log('[Fashion-AI] Generated ' + scripts.length + ' scripts via template fallback');
        return scripts;
    }

    /* ════════════════════════════════════════════
       HELPERS
       ════════════════════════════════════════════ */
    function _getDefaultScenes(subMode) {
        switch (subMode) {
            case 'spin': return 1;
            case 'runway': return 4;
            case 'dance': return 1;
            case 'lookbook': return 3;
            case 'shop': return 2;
            case 'tryon': return 1;
            default: return 1;
        }
    }

    function _getGeminiKey() {
        try {
            var raw = localStorage.getItem('geminiApiKey');
            if (raw) {
                try { return JSON.parse(raw); } catch (e) { return raw; }
            }
            raw = localStorage.getItem('apiKey');
            if (raw) {
                try { return JSON.parse(raw); } catch (e) { return raw; }
            }
        } catch (e) { }
        return null;
    }

    async function _callGeminiAPI(apiKey, systemPrompt, userPrompt) {
        const cleanKey = apiKey.replace(/["'\s]/g, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;

        const body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 4096
            }
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error('Gemini API Error (' + resp.status + '): ' + errText.substring(0, 200));
        }

        const data = await resp.json();
        return data.candidates[0].content.parts[0].text || '';
    }

    function _parseJSON(text) {
        // Try to extract JSON from markdown code blocks
        var jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        var jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

        // Remove any leading/trailing non-JSON characters
        var firstBrace = jsonStr.indexOf('{');
        var lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.warn('[Fashion-AI] JSON parse error:', e.message);
            return null;
        }
    }

    /* ════════════════════════════════════════════
       EXPORTS
       ════════════════════════════════════════════ */
    window.__fashionAI = {
        generateStoryboard: generateStoryboard,
        SYSTEM_PROMPT: SYSTEM_PROMPT
    };

    console.log('[Fashion] AI storyboard generator loaded');
})();
