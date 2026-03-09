/**
 * fashion-prompt.js — Fashion Mode UGC Prompt Engine
 * Generates AI prompts for image + video creation in UGC/natural style
 * Sub-modes: Spin, Runway, Dance, Lookbook, In-Shop, Virtual Try-On
 */
(function () {
    'use strict';

    /* ════════════════════════════════════════════
       LOCATIONS — Background / setting templates
       ════════════════════════════════════════════ */
    const LOCATIONS = {
        studio: 'clean minimalist studio with soft white background, ring light',
        bedroom: 'cozy modern bedroom with warm lighting, aesthetic room',
        cafe: 'trendy cafe interior with warm ambient lighting, aesthetic vibes',
        street: 'urban city street with golden hour sunlight, modern buildings',
        park: 'beautiful green park with natural sunlit path, trees',
        beach: 'tropical beach with soft sand and ocean waves, sunset light',
        mall: 'modern shopping mall with bright interior, clean floor',
        shop: 'cozy boutique clothing store with warm lighting, racks of clothes'
    };

    /* ════════════════════════════════════════════
       CLOTHING CATEGORIES
       ════════════════════════════════════════════ */
    const CLOTHING_CATEGORIES = {
        top: 'เสื้อ / Top',
        bottom: 'กางเกง-กระโปรง / Bottom',
        dress: 'ชุดเดรส / Dress',
        sportswear: 'ชุดกีฬา / Sportswear',
        outerwear: 'เสื้อคลุม / Outerwear',
        swimwear: 'ชุดว่ายน้ำ / Swimwear',
        set: 'เซ็ตชุด / Full Set',
        accessory: 'เครื่องประดับ / Accessories'
    };

    /* ════════════════════════════════════════════
       TONES — Color grading / vibe
       ════════════════════════════════════════════ */
    const TONES = {
        warm: 'warm golden tones, cozy feel',
        cool: 'cool blue tones, fresh and modern',
        natural: 'natural colors, no filter, realistic',
        vibrant: 'vibrant saturated colors, punchy look',
        pastel: 'soft pastel colors, dreamy aesthetic',
        moody: 'moody dark tones, dramatic contrast'
    };

    /* ════════════════════════════════════════════
       UGC BASE KEYWORDS — ใส่ทุก prompt
       ════════════════════════════════════════════ */
    const UGC_STYLE = 'real person, UGC style, smartphone camera quality, natural lighting, authentic feel, not overly posed';

    /* ════════════════════════════════════════════
       POSE LIBRARIES (per sub-mode)
       ════════════════════════════════════════════ */
    const POSES = {
        spin: [
            'facing camera, hands on hips, confident stance',
            'slightly turned to the side, looking over shoulder',
            'arms relaxed at sides, natural standing pose',
            'one hand touching hair, gentle tilt'
        ],
        runway: {
            scenes: [
                { name: 'เดินเข้ามา', pose: 'walking confidently toward camera, full body shot, runway stride' },
                { name: 'โชว์ดีเทล', pose: 'upper body close-up, showing fabric detail, slight smile' },
                { name: 'หันหลังโชว์', pose: 'turning around showing back of outfit, looking over shoulder' },
                { name: 'โพสปิดท้าย', pose: 'final pose facing camera, hand on hip, confident smile' }
            ]
        },
        dance: [
            'gentle swaying to music, relaxed body movement',
            'light TikTok style dance, fun casual moves',
            'spinning with arms out, joyful expression',
            'body wave movement, confident groove'
        ],
        lookbook: [
            'standing pose, one hand on hip, looking at camera',
            'sitting on chair casually, legs crossed',
            'leaning against wall, relaxed cool vibe',
            'walking mid-step, candid shot',
            'looking away from camera, profile view'
        ],
        shop: [
            'picking up clothing from rack, examining it',
            'holding outfit against body in front of mirror',
            'trying on outfit, checking fit in mirror',
            'browsing through clothing rack, casual shopping'
        ],
        tryon: [
            'wearing the exact clothing, standing front view, natural pose',
            'wearing the exact clothing, slight turn showing fit',
            'wearing the exact clothing, full body mirror selfie style'
        ]
    };

    /* ════════════════════════════════════════════
       PROMPT BUILDERS — per sub-mode
       ════════════════════════════════════════════ */

    /**
     * Build image prompt for a single scene
     * @param {Object} opts
     * @param {string} opts.subMode - spin|runway|dance|lookbook|shop|tryon
     * @param {string} opts.clothingDesc - description of the clothing
     * @param {string} opts.modelGender - female|male
     * @param {string} opts.modelDesc - optional model appearance description
     * @param {string} opts.location - key from LOCATIONS
     * @param {string} opts.tone - key from TONES
     * @param {number} opts.sceneIndex - scene number (for multi-scene modes)
     * @param {string} opts.poseOverride - optional custom pose
     * @returns {string} image prompt
     */
    function buildImagePrompt(opts) {
        const gender = opts.modelGender === 'male' ? 'young man' : 'young woman';
        const modelDesc = opts.modelDesc ? `, ${opts.modelDesc}` : '';
        const location = LOCATIONS[opts.location] || LOCATIONS.studio;
        const tone = TONES[opts.tone] || TONES.natural;
        let pose = opts.poseOverride || '';

        switch (opts.subMode) {
            case 'spin':
                pose = pose || _randomPick(POSES.spin);
                return `A real ${gender}${modelDesc} wearing ${opts.clothingDesc}, ${pose}, ${location}, ${tone}, ${UGC_STYLE}, full body shot, 9:16 vertical`;

            case 'runway':
                var sceneData = POSES.runway.scenes[opts.sceneIndex] || POSES.runway.scenes[0];
                pose = pose || sceneData.pose;
                return `A real ${gender}${modelDesc} wearing ${opts.clothingDesc}, ${pose}, ${location}, ${tone}, ${UGC_STYLE}, fashion video still`;

            case 'dance':
                pose = pose || _randomPick(POSES.dance);
                return `A real ${gender}${modelDesc} wearing ${opts.clothingDesc}, ${pose}, ${location}, ${tone}, ${UGC_STYLE}, energetic vibe, full body shot`;

            case 'lookbook':
                pose = pose || POSES.lookbook[opts.sceneIndex % POSES.lookbook.length];
                return `A real ${gender}${modelDesc} wearing ${opts.clothingDesc}, ${pose}, ${location}, ${tone}, ${UGC_STYLE}, fashion lookbook style`;

            case 'shop':
                pose = pose || _randomPick(POSES.shop);
                return `A real ${gender}${modelDesc}, ${pose}, ${opts.clothingDesc} visible, inside ${LOCATIONS.shop}, ${tone}, ${UGC_STYLE}, cozy shopping atmosphere`;

            case 'tryon':
                pose = pose || _randomPick(POSES.tryon);
                return `A real ${gender}${modelDesc} ${pose}, the clothing is ${opts.clothingDesc}, perfectly fitted, ${location}, ${tone}, ${UGC_STYLE}, virtual try-on visualization, photorealistic`;

            default:
                return `A real ${gender}${modelDesc} wearing ${opts.clothingDesc}, natural pose, ${location}, ${tone}, ${UGC_STYLE}`;
        }
    }

    /**
     * Build video prompt for a single scene
     */
    function buildVideoPrompt(opts) {
        switch (opts.subMode) {
            case 'spin':
                return 'The person slowly spins 360 degrees to showcase the outfit, natural casual movement, gentle turn, real person feel, smartphone video quality';

            case 'runway':
                var sceneIdx = opts.sceneIndex || 0;
                var runwayVideos = [
                    'The person walks confidently toward the camera, natural gait, subtle body sway, UGC phone video feel',
                    'Camera zooms in on the outfit details, the person poses briefly showing fabric and fit, gentle movement',
                    'The person turns around slowly showing the back of the outfit, looks over shoulder, natural movement',
                    'The person strikes a final pose with a smile, stylish confident stance, natural ending'
                ];
                return runwayVideos[sceneIdx] || runwayVideos[0];

            case 'dance':
                return 'The person starts dancing naturally, fun casual movement, showing off the outfit while moving, TikTok dance style, happy expression, energetic but natural';

            case 'lookbook':
                var lookbookVideos = [
                    'The person poses naturally, gentle subtle movement, slight body sway, showing the outfit from front angle',
                    'The person shifts position, crosses legs differently, relaxed natural movement, candid feel',
                    'The person turns slightly side to side, showing the outfit silhouette, calm gentle movement',
                    'The person walks a few steps, casual stride, then pauses in a natural pose',
                    'The person looks to the side then back at camera, gentle hair touch, authentic moment'
                ];
                return lookbookVideos[(opts.sceneIndex || 0) % lookbookVideos.length];

            case 'shop':
                return 'The person browses through clothes naturally, picks up the clothing item, holds it against their body, examining it with interest, genuine shopping experience, phone camera recording feel';

            case 'tryon':
                return 'The person wearing the outfit does a gentle spin and pose, showing how the clothing fits and moves naturally, authentic try-on review, smartphone selfie video quality';

            default:
                return 'Natural gentle movement, showing the outfit casually, real person authentic feel';
        }
    }

    /**
     * Build full storyboard config (multi-scene)
     */
    function buildStoryboard(opts) {
        var sceneCount = opts.sceneCount || 1;
        var scenes = [];

        for (var i = 0; i < sceneCount; i++) {
            var sceneOpts = Object.assign({}, opts, { sceneIndex: i });
            scenes.push({
                index: i + 1,
                imagePrompt: buildImagePrompt(sceneOpts),
                videoPrompt: buildVideoPrompt(sceneOpts),
                sceneName: _getSceneName(opts.subMode, i)
            });
        }

        return {
            subMode: opts.subMode,
            totalScenes: sceneCount,
            scenes: scenes,
            captionStyle: 'fashion_ugc'
        };
    }

    /**
     * Build fashion-specific caption with hashtags
     */
    function buildCaption(opts) {
        var productName = opts.productName || 'ชุดนี้';
        var price = opts.price ? ` ราคา ${opts.price} บาท` : '';
        var extra = opts.extraCaption ? `\n${opts.extraCaption}` : '';

        var captions = [
            `✨ ${productName}${price} สวยมากแม่! ลองแล้วปังเว่อร์${extra}`,
            `🔥 รีวิว ${productName}${price} ใส่จริง สวยจริง ไม่จกตา${extra}`,
            `💃 ${productName}${price} ชุดนี้ต้องมี! ใส่แล้วดูแพง${extra}`,
            `👗 ${productName}${price} ของมันต้องมี สวยเกินราคา${extra}`,
            `🛍 มาแล้วจ้า ${productName}${price} ใส่สบาย สวยปัง${extra}`
        ];

        var hashtags = [
            '#OOTD', '#FashionTikTok', '#รีวิวเสื้อผ้า', '#แฟชั่น',
            '#สวยมาก', '#ชุดสวย', '#เสื้อผ้าแฟชั่น', '#TikTokFashion',
            '#ลองชุด', '#แต่งตัว'
        ];

        var selectedCaption = _randomPick(captions);
        var selectedHashtags = _shuffleAndPick(hashtags, 5).join(' ');

        return selectedCaption + '\n\n' + selectedHashtags;
    }

    /* ════════════════════════════════════════════
       HELPERS
       ════════════════════════════════════════════ */
    function _randomPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function _shuffleAndPick(arr, count) {
        var shuffled = arr.slice().sort(function () { return Math.random() - 0.5; });
        return shuffled.slice(0, count);
    }

    function _getSceneName(subMode, index) {
        if (subMode === 'runway') {
            var names = ['เดินเข้ามา', 'โชว์ดีเทล', 'หันหลังโชว์', 'โพสปิดท้าย'];
            return names[index] || ('ฉาก ' + (index + 1));
        }
        if (subMode === 'lookbook') {
            return 'Look ' + (index + 1);
        }
        return 'ฉาก ' + (index + 1);
    }

    /* ════════════════════════════════════════════
       EXPORTS
       ════════════════════════════════════════════ */
    window.__fashionPrompt = {
        buildImagePrompt: buildImagePrompt,
        buildVideoPrompt: buildVideoPrompt,
        buildStoryboard: buildStoryboard,
        buildCaption: buildCaption,
        LOCATIONS: LOCATIONS,
        CLOTHING_CATEGORIES: CLOTHING_CATEGORIES,
        TONES: TONES,
        POSES: POSES
    };

    console.log('[Fashion] Prompt engine loaded');
})();
