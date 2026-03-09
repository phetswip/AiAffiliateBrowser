/**
 * Story Mode - Gemini AI Storyboard Generation
 * Extracted from PD AUTO FLOW v15.1.6
 *
 * ใช้ Gemini API สร้าง Storyboard อัตโนมัติจากหัวข้อ
 */

// ============================================================
// STYLE MAPPINGS
// ============================================================

const IMAGE_STYLE_MAP = {
  pixar_3d: 'Pixar 3D Animation style, vibrant colors, expressive characters, smooth rendering, Disney-quality lighting',
  disney_3d: 'Disney 3D Animation style, magical atmosphere, beautiful detailed environments, warm lighting',
  anime: 'Japanese Anime style, dynamic expressions, vivid colors, anime-style shading',
  realistic: 'Photorealistic cinematic style, natural lighting, high detail skin texture, realistic proportions, movie-quality visuals, 8K resolution',
  cartoon_2d: '2D Cartoon style, bold outlines, bright colors, playful design',
  watercolor: 'Watercolor painting style, soft colors, artistic brush strokes, dreamy atmosphere'
};

// v13 product storyboard styles (สำรอง)
const PRODUCT_STYLE_MAP = {
  product_showcase: 'ถ่ายสินค้าสวยๆ มุมมองหลากหลาย เน้นรายละเอียดสินค้า',
  cinematic: 'สไตล์ภาพยนตร์ มีความลึก มืดๆ dramatic lighting',
  minimalist: 'พื้นหลังเรียบๆ โทนสีอบอุ่น เน้นสินค้า',
  luxury: 'หรูหรา พื้นหลังหินอ่อน แสง soft elegant',
  energetic: 'สีสันสดใส มีชีวิตชีวา dynamic',
  natural: 'ธรรมชาติ มีต้นไม้ แสงธรรมชาติ'
};

// ============================================================
// IMAGE MOOD VISUAL (สไตล์ภาพตาม mood)
// ============================================================

const IMAGE_MOOD_VISUAL = {
  viral_roast: 'exaggerated annoyed expression, animated pointing gesture, bold dramatic lighting, vibrant saturated colors',
  crude: 'stern frustrated expression, expressive body language, dramatic lighting, bold cartoon atmosphere',
  aggressive: 'intense serious expression, powerful confident stance, strong contrast lighting',
  troll: 'mischievous smirk, playful teasing pose, colorful fun lighting',
  scolding: 'stern disapproving frown, lecturing gesture with crossed arms, bright authoritative lighting',
  tough_love: 'serious caring expression, firm protective pose, warm strong lighting',
  funny: 'exaggerated hilarious expression, comedic silly pose, bright playful atmosphere',
  exciting: 'wide-eyed thrilled expression, dynamic action pose, high-energy vivid lighting',
  scary: 'eerie unsettling mood, tense cautious pose, dark moody shadows',
  cute: 'adorable sweet expression, gentle cute pose, soft pastel warm lighting',
  serious: 'focused stern expression, upright formal pose, clean professional lighting',
  sarcastic: 'knowing smirk, casual witty pose, playful moody lighting',
  Friendly: 'warm genuine smile, open welcoming pose, soft cozy lighting',
  Enthusiastic: 'excited sparkling eyes, energetic dynamic pose, bright vibrant colors',
  Professional: 'confident composed look, professional clean stance, sleek corporate lighting',
  Energetic: 'powerful dynamic pose, intense expression, vivid saturated action colors',
  Calm: 'peaceful serene face, relaxed gentle pose, soft diffused pastel lighting',
  Persuasive: 'confident engaging expression, leaning-in pose, warm persuasive lighting',
  Humorous: 'funny playful face, comedic exaggerated pose, cheerful bright colors',
  Informative: 'thoughtful knowledgeable look, presenting gesture, clean bright lighting',
  Dramatic: 'intense emotional expression, theatrical dramatic pose, cinematic moody lighting with shadows',
  Casual: 'relaxed natural face, laid-back casual pose, warm natural lighting',
  Rapper: 'cool confident swagger, hip-hop hand gesture, neon urban street lighting',
  isan: 'warm rural Thai expression, down-to-earth pose, natural outdoor lighting',
  isan_crude: 'stern rural expression, expressive animated pose, bright outdoor lighting',
  southern: 'warm Southern Thai expression, relaxed easy pose, tropical bright lighting',
  southern_crude: 'stern Southern expression, expressive animated pose, bright tropical lighting',
  northern: 'gentle Northern Thai expression, serene calm pose, cool mountain lighting',
  northern_crude: 'stern Northern expression, expressive animated pose, cool bright lighting',
  cartoon_cute: 'adorable kawaii expression, cute bouncy pose, sparkly pastel magical atmosphere',
  soft_warm: 'gentle warm expression, soft cozy pose, golden dreamy soft lighting',
  cheerful: 'bright happy face, joyful bouncy pose, sunny vibrant atmosphere',
  mysterious: 'mysterious intriguing gaze, subtle enigmatic pose, dark foggy atmospheric lighting',
  energetic: 'high-energy intense pose, powerful expression, bold vivid action lighting',
  calm: 'serene peaceful face, still gentle pose, soft floating diffused light',
  dramatic: 'theatrical intense expression, wide dramatic pose, cinematic deep shadow lighting'
};

// ============================================================
// VIDEO MOOD MOTION (สไตล์วิดีโอตาม mood)
// ============================================================

const VIDEO_MOOD_MOTION = {
  viral_roast: 'dynamic zoom-ins, punchy quick cuts, energetic camera movement, high energy pacing',
  crude: 'dynamic handheld camera, expressive close-ups, energetic quick movements',
  aggressive: 'powerful zoom-ins, dramatic sweeping camera, strong dynamic motion',
  troll: 'playful bouncy camera, quick zoom gags, fun dynamic wobble',
  scolding: 'firm steady shots with sudden emphatic zoom-ins, sharp authoritative focus',
  tough_love: 'steady camera with firm zoom-ins, deliberate controlled movement',
  funny: 'bouncy playful camera, comedic timing cuts, fun quick zooms',
  exciting: 'fast dramatic reveals, thrilling camera sweeps, high-tension dynamic motion',
  scary: 'creepy slow dolly, sudden jerky movements, suspenseful shaky cam',
  cute: 'soft gentle floating, adorable slow wobble, warm smooth panning',
  serious: 'steady precise camera, clean professional pans, controlled measured movement',
  sarcastic: 'subtle slow zoom-ins, knowing steady pans, witty-timed camera movement',
  Friendly: 'warm smooth panning, gentle inviting movement, cozy steady tracking',
  Enthusiastic: 'energetic dynamic zooms, exciting quick pans, lively vibrant camera',
  Professional: 'smooth steady dolly, clean professional pans, polished camera work',
  Energetic: 'fast dynamic cuts, high-energy zooms, action-paced quick movement',
  Calm: 'very slow gentle pans, peaceful floating, minimal serene movement',
  Persuasive: 'steady engaging camera, confident slow zoom-ins, compelling smooth movement',
  Humorous: 'playful bouncy motion, comedic zoom timing, fun quick camera moves',
  Informative: 'clean steady shots, smooth organized pans, clear focused movement',
  Dramatic: 'cinematic slow sweeps, dramatic zoom reveals, moody atmospheric motion',
  Casual: 'natural handheld feel, relaxed casual panning, easy-going gentle movement',
  Rapper: 'rhythmic camera bounce, hip-hop style movement, urban dynamic tracking',
  isan: 'natural steady movement, warm gentle panning, rural relaxed atmosphere',
  isan_crude: 'energetic dynamic movement, expressive close-ups, lively quick motion',
  southern: 'relaxed tropical movement, warm gentle pans, natural easy flow',
  southern_crude: 'energetic lively movement, expressive quick energy, dynamic bold motion',
  northern: 'gentle serene movement, peaceful slow pans, calm cool atmosphere',
  northern_crude: 'energetic dynamic movement, expressive close-ups, bold quick motion',
  cartoon_cute: 'cute bouncy wobble, adorable gentle floating, sparkly smooth motion',
  soft_warm: 'very gentle slow floating, soft dreamy pans, warm minimal motion',
  cheerful: 'bright energetic bounce, happy lively camera, fun quick joyful movement',
  mysterious: 'slow creeping dolly, suspenseful atmospheric pans, foggy drifting motion',
  energetic: 'fast high-energy cuts, dynamic powerful zooms, quick intense movement',
  calm: 'very slow peaceful floating, gentle serene pans, minimal still movement',
  dramatic: 'epic cinematic sweeps, dramatic slow-motion reveals, theatrical grand camera movement'
};

// ============================================================
// VIDEO VOICE TONE (โทนเสียงพากย์ตาม mood)
// ============================================================

const VIDEO_VOICE_TONE = {
  viral_roast: 'furious yelling narration, screaming angry scolding voice, loud aggressive roasting tone, like someone shouting insults passionately',
  crude: 'harsh screaming narration, furious vulgar angry voice, loud aggressive yelling tone, like a street fighter trash-talking with raw intensity',
  aggressive: 'fierce commanding narration, loud intimidating powerful voice, aggressive shouting authoritative tone, like a drill sergeant barking orders',
  troll: 'mocking sneering narration, condescending teasing voice with evil smirk energy, passive-aggressive taunting tone',
  scolding: 'loud angry scolding narration, sharp furious lecturing voice, like a strict parent yelling at their child with disappointment',
  tough_love: 'firm caring narration, serious but warm concerned voice',
  funny: 'cheerful comedic narration, playful humorous voice with laugh energy',
  exciting: 'thrilling high-energy narration, excited breathless voice',
  scary: 'eerie suspenseful narration, tense whispering mysterious voice',
  cute: 'sweet gentle narration, soft adorable warm voice',
  serious: 'calm professional narration, measured informative steady voice',
  sarcastic: 'dry witty narration, knowing sarcastic tone with subtle humor',
  Friendly: 'warm friendly narration, inviting cozy conversational voice',
  Enthusiastic: 'excited energetic narration, passionate vibrant enthusiastic voice',
  Professional: 'polished professional narration, clean confident corporate voice',
  Energetic: 'high-energy powerful narration, dynamic intense vibrant voice',
  Calm: 'peaceful gentle narration, soft serene relaxing voice',
  Persuasive: 'confident compelling narration, engaging persuasive smooth voice',
  Humorous: 'funny light-hearted narration, comedic playful cheerful voice',
  Informative: 'clear knowledgeable narration, steady informative educational voice',
  Dramatic: 'theatrical emotional narration, dramatic intense cinematic voice',
  Casual: 'relaxed casual narration, laid-back natural conversational voice',
  Rapper: 'rhythmic rap-style narration, cool confident urban hip-hop voice',
  isan: 'warm rural narration, natural down-to-earth friendly voice',
  isan_crude: 'furious Isan-accented narration, loud angry screaming scolding voice, aggressive yelling rural tone',
  southern: 'warm relaxed narration, natural easy-going southern voice',
  southern_crude: 'furious Southern-accented narration, loud angry screaming scolding voice, aggressive yelling southern tone',
  northern: 'gentle serene narration, calm peaceful northern voice',
  northern_crude: 'furious Northern-accented narration, loud angry screaming scolding voice, aggressive yelling northern tone',
  cartoon_cute: 'adorable cute narration, sweet high-pitched cheerful voice',
  soft_warm: 'gentle dreamy narration, soft warm soothing voice',
  cheerful: 'bright happy narration, joyful energetic sunny voice',
  mysterious: 'enigmatic atmospheric narration, deep mysterious intriguing voice',
  energetic: 'high-energy intense narration, powerful dynamic fast-paced voice',
  calm: 'peaceful serene narration, gentle quiet relaxing voice',
  dramatic: 'grand theatrical narration, emotional intense cinematic voice'
};

// ============================================================
// MOOD / TONE MAPPINGS
// ============================================================

const MOOD_MAP = {
  // โทนทั่วไป
  tough_love: 'Tough Love tone - firm but caring, direct criticism with good intentions, like a strict parent or coach',
  funny: 'Funny/Comedic tone - playful humor, jokes, memes, light-hearted delivery',
  exciting: 'Exciting/Thrilling tone - high energy, tension, dramatic reveals, cliffhangers',
  scary: 'Scary/Horror tone - suspenseful, creepy atmosphere, unexpected twists',
  cute: 'Cute/Warm tone - adorable characters, heartwarming moments, gentle delivery',
  serious: 'Serious/Educational tone - informative, factual, straightforward teaching',
  sarcastic: 'Sarcastic tone - witty commentary, ironic observations, playful mockery',
  aggressive: 'Aggressive/Intense tone - ดุดันจริงจัง กระแทกหน้า พูดตรงๆ ไม่อ้อมค้อม เช่น "ทำห่าอะไรอยู่วะ!" "ไม่ทำตามก็ตายห่าไปเลย!" "กูพูดตรงๆ นะ" ใช้คำหยาบปานกลาง ดุแต่มีสาระ',
  troll: 'Trolling/Teasing tone - กวนตีนสุดๆ แซวจิกกัดเล่นแบบเจ็บๆ คันๆ เช่น "อ้าว ไม่รู้จริงๆ เหรอวะ?" "โห คนไม่รู้เรื่องนี้ยังมีอีกเหรอ" "น่าสงสาร ไม่มีใครบอกเลยสินะ" แซวแบบเหน็บแต่ให้ความรู้',
  scolding: 'Scolding tone - สอนดุบ่นจี้เหมือนแม่ดุลูก เช่น "บอกกี่ครั้งแล้ว!" "ไม่เคยฟังเลยใช่มั้ย!" "จะให้พูดอีกกี่รอบ!" ดุเข้มแต่เป็นห่วง',
  crude: 'Crude 18+ tone - หยาบคายเต็มพิกัด ด่าจริงเหมือนเพื่อนสนิทด่ากัน เช่น "กูบอกแล้วไง!" "มึงจะโง่ไปถึงไหนวะ!" "ไอ้สัส ทำแบบนี้สิถึงจะถูก!" ใช้ มึง/กู/ว่ะ/วะ/โว้ย/เว้ย ตลอด **ห้ามใช้ ครับ/ค่ะ/นะคะ เด็ดขาด**',

  // ภาษาถิ่น
  isan: 'Isan dialect - ภาษาอีสาน',
  isan_crude: 'Isan Crude 18+ - อีสานหยาบ เช่น "เจ้าสิเฮ็ดจั่งได๋วะ!" "บ่ฟังกูเลยบ้อ!" "ไอ้บ้า เฮ็ดแบบนี้สิแม่นแล้ว!" ใช้ภาษาอีสานหยาบเต็มที่',
  southern: 'Southern Thai dialect - ภาษาใต้',
  southern_crude: 'Southern Crude 18+ - ใต้หยาบ เช่น "ไอ้หน้าหี ทำจังหวะนี้สิหรอย!" "หมาน้อง ฟังกูนี่!" "เปิดหูฟังดีๆ นะไอ้เหี้ย!" ใช้ภาษาใต้หยาบเต็มที่',
  northern: 'Northern Thai/Kam Muang dialect - ภาษาเหนือ/คำเมือง',
  northern_crude: 'Northern Crude 18+ - เหนือหยาบ เช่น "ไอ้บ่าเดี๋ยก! เยี๊ยะจาอั้นสิถูกแล้ว!" "บ่าฟังกูเลยก่อ!" ใช้คำเมืองหยาบเต็มที่',

  // Speaking Styles (จาก mode-8s)
  Friendly: 'Friendly speaking style - เป็นมิตร อบอุ่น เหมือนเพื่อนคุยกัน พูดสบายๆ ใกล้ชิด',
  Enthusiastic: 'Enthusiastic speaking style - ตื่นเต้น กระตือรือร้น มีพลังงานสูง ชวนให้สนใจ',
  Professional: 'Professional speaking style - มืออาชีพ น่าเชื่อถือ สุภาพ พูดชัดเจน',
  Energetic: 'Energetic speaking style - มีพลัง กระฉับกระเฉง พูดเร็ว กระตุ้นอารมณ์',
  Calm: 'Calm speaking style - สงบ ผ่อนคลาย พูดช้าๆ นุ่มนวล ให้ความรู้สึกสบาย',
  Persuasive: 'Persuasive speaking style - โน้มน้าว ชวนเชื่อ สร้างความมั่นใจ ใช้เหตุผล',
  Humorous: 'Humorous speaking style - ตลกขบขัน มุกตลก สนุกสนาน ทำให้ยิ้มได้',
  Informative: 'Informative speaking style - ให้ข้อมูล อธิบายชัดเจน ครบถ้วน เข้าใจง่าย',
  Dramatic: 'Dramatic speaking style - ดราม่า เน้นอารมณ์สูงต่ำ เว้นจังหวะดราม่า',
  Casual: 'Casual speaking style - สบายๆ ชิลล์ ไม่เป็นทางการ เหมือนคุยกับเพื่อน',
  Rapper: 'Rapper speaking style - แร็พเปอร์ พูดเป็นจังหวะ มี flow มีสัมผัส',
  viral_roast: 'Viral Roast speaking style - หยาบคายดุดันสุดๆ ด่าคนดูแบบตรงๆ เช่น "มึงโง่ว่ะ!" "กูบอกแล้ว!" "ทำไมไม่ฟังวะ!" **ห้ามใช้ ครับ/ค่ะ/นะคะ/จ้า เด็ดขาด** ใช้คำลงท้ายหยาบ เช่น ว่ะ วะ โว้ย เว้ย แทน พูดเหมือนเพื่อนด่ากัน ไม่ต้องสุภาพ กวนตีนแต่มีสาระ'
};

// ============================================================
// VOICE STYLE SPECS (เสียงพิเศษ)
// ============================================================

const VOICE_STYLE_MAP = {
  cartoon_cute: 'เสียงพากย์ต้องเป็นสไตล์การ์ตูนน่ารัก - ใช้คำหวานๆ ท้ายคำเช่น นะคะ จ้า ค่า พูดน่ารัก เสียงแหลมหวาน เหมือนตัวการ์ตูน ใส่เสียงอุทาน เย้! ว้าว! บ่อยๆ',
  soft_warm: 'เสียงพากย์ต้องเป็นสไตล์นุ่มนวลอบอุ่น - พูดช้าๆ เบาๆ เหมือนกระซิบกระซาบ ใช้คำอ่อนโยน ค่อยๆ นะ เบาๆ นะ ให้รู้สึกสบายใจ ผ่อนคลาย',
  cheerful: 'เสียงพากย์ต้องเป็นสไตล์สดใสร่าเริง - พูดมีชีวิตชีวา มีพลังงานสูง ใช้อุทาน โอ้โห! เจ๋งมาก! สุดยอด! บ่อยๆ ให้รู้สึกตื่นเต้น',
  mysterious: 'เสียงพากย์ต้องเป็นสไตล์ลึกลับน่าสนใจ - พูดช้าๆ เว้นจังหวะให้ลุ้น ใช้คำถามชวนสงสัย รู้ไหมว่า... แต่ว่า... เสียงทุ้มๆ',
  energetic: 'เสียงพากย์ต้องเป็นสไตล์เร้าใจตื่นเต้น - พูดเร็ว กระชับ เน้นย้ำคำสำคัญ ใช้คำกระตุ้น เร็ว! ทันที! สร้างความเร่งด่วน',
  calm: 'เสียงพากย์ต้องเป็นสไตล์สงบผ่อนคลาย - พูดช้า สบายๆ เว้นจังหวะนานๆ ใช้คำสงบ ค่อยๆ ไม่ต้องรีบ ผ่อนคลาย',
  dramatic: 'เสียงพากย์ต้องเป็นสไตล์ดราม่าอารมณ์ - เน้นอารมณ์สูงต่ำ พูดเว้นจังหวะดราม่า ใช้คำเปรียบเทียบ ราวกับว่า... เหมือนโลกพังทลาย'
};

// ============================================================
// TARGET AUDIENCE MAPPINGS
// ============================================================

const AUDIENCE_MAP = {
  general: 'General audience - accessible language, universal themes',
  teen: 'Teen audience - trendy language, relatable youth issues, social media aware',
  working: 'Working adults - professional concerns, work-life balance, practical advice',
  housewife: 'Housewives - family topics, home management, health consciousness',
  elderly: 'Elderly audience - respectful tone, health topics, traditional values',
  kids: 'Kids audience - simple language, fun characters, educational content'
};

// ============================================================
// GENDER SYSTEM
// ============================================================

const GENDER_RULES = {
  female: {
    label: 'FEMALE',
    thai: 'ผู้หญิง',
    endings: 'ค่ะ, นะคะ, ค่อ, ค่า',
    rule: 'ผู้หญิง - ใช้คำลงท้าย "ค่ะ", "นะคะ"'
  },
  male: {
    label: 'MALE',
    thai: 'ผู้ชาย',
    endings: 'ครับ, นะครับ',
    rule: 'ผู้ชาย - ใช้คำลงท้าย "ครับ", "นะครับ"'
  }
};

// ============================================================
// v15 STORY MODE SYSTEM PROMPT
// ============================================================

/**
 * สร้าง System Prompt สำหรับ Story Mode
 * @param {Object} config
 * @param {string} config.style - pixar_3d, disney_3d, anime, realistic, cartoon_2d, watercolor
 * @param {string} config.mood - tough_love, funny, scary, etc.
 * @param {string} config.targetAudience - general, teen, working, etc.
 * @param {number} config.sceneCount - จำนวนฉาก (2-10)
 * @param {string} config.aspectRatio - '9:16' or '16:9'
 * @param {boolean} config.hasCharacters - มีตัวละครหรือไม่
 * @param {Array} config.characters - [{name, desc}]
 * @param {boolean} config.isRealisticMode - โหมด Realistic
 * @param {string} config.voiceGender - 'female' or 'male'
 * @param {string} config.language - 'th' or 'en'
 * @returns {string} System prompt
 */
function buildStoryModeSystemPrompt(config) {
  const {
    style = 'pixar_3d',
    mood = 'tough_love',
    targetAudience = 'general',
    sceneCount = 4,
    aspectRatio = '9:16',
    hasCharacters = false,
    characters = [],
    isRealisticMode = false,
    voiceGender = 'female',
    language = 'th',
    sceneConfigs = []
  } = config;

  const styleDesc = IMAGE_STYLE_MAP[style] || IMAGE_STYLE_MAP.pixar_3d;
  const moodDesc = MOOD_MAP[mood] || VOICE_STYLE_MAP[mood] || MOOD_MAP.tough_love;
  const audienceDesc = AUDIENCE_MAP[targetAudience] || AUDIENCE_MAP.general;
  const gender = GENDER_RULES[voiceGender] || GENDER_RULES.female;

  // ตรวจสอบว่าเป็นโหมดหยาบหรือไม่
  const crudeMoods = ['viral_roast', 'crude', 'aggressive', 'troll', 'scolding', 'isan_crude', 'southern_crude', 'northern_crude'];
  const isCrudeMode = crudeMoods.includes(mood);

  // ถ้าเป็นโหมดหยาบ ไม่บังคับคำลงท้าย
  const effectiveGender = isCrudeMode ? {
    ...gender,
    endings: 'ไม่บังคับคำลงท้าย (ห้าม ค่ะ ครับ นะคะ นะครับ — จะจบยังไงก็ได้)',
    rule: 'โหมดหยาบคาย — ห้ามใช้คำสุภาพ ไม่บังคับคำลงท้าย'
  } : gender;

  // Voice style override (ถ้าเป็นสไตล์เสียงพิเศษ)
  const voiceStyleNote = VOICE_STYLE_MAP[mood] ? `\n\n## สไตล์เสียงพิเศษ\n${VOICE_STYLE_MAP[mood]}` : '';

  // Character personality based on speaking style
  const moodPersonality = {
    viral_roast: 'หน้าตาหงุดหงิด ไม่พอใจ ท่าทางชี้นิ้วสอน ตาเขียว กอดอก',
    crude: 'หน้าตาบึ้ง ไม่พอใจ ท่าทางเร่าร้อน กอดอก ชี้หน้า',
    aggressive: 'หน้าตาจริงจัง มุ่งมั่น ท่าทางแข็งแกร่ง มั่นใจ',
    troll: 'หน้ายิ้มแกล้ง ตาขยิบ ท่าทางกวนๆ ซุกซน',
    scolding: 'หน้าตาบึ้ง จ้องตา ท่าทางสอนดุ เหมือนครูดุ',
    tough_love: 'หน้าตาจริงจังแต่ห่วงใย ท่าทางเหมือนพี่สอนน้อง',
    funny: 'หน้าตาตลก ยิ้มกว้าง ท่าทางขำๆ เล่นมุก',
    Friendly: 'หน้ายิ้มอบอุ่น ตาเป็นมิตร ท่าทางเปิดรับ น่าคบ',
    Enthusiastic: 'หน้าตาตื่นเต้น ตาเป็นประกาย ท่าทางกระตือรือร้น',
    Professional: 'หน้าตาสุภาพ มืออาชีพ ท่าทางน่าเชื่อถือ',
    Energetic: 'หน้ามีพลัง กระฉับกระเฉง ท่าทาง dynamic',
    Calm: 'หน้าสงบ ผ่อนคลาย ท่าทางนิ่งสบาย',
    Humorous: 'หน้าตลก ยิ้มซน ท่าทางขำๆ',
    Dramatic: 'หน้าตาดราม่า อารมณ์สูงต่ำ ท่าทางเว่อร์',
    Casual: 'หน้าสบายๆ ชิลล์ ท่าทางธรรมชาติ',
    Rapper: 'หน้าเท่ ท่าทาง hip-hop มือทำ gesture แร็พ'
  };
  const characterPersonality = moodPersonality[mood] || 'หน้าตาและท่าทางสอดคล้องกับโทนเสียง';

  // Mood-specific visual & motion style for image/video prompts
  const imageMoodVisual = IMAGE_MOOD_VISUAL[mood] || 'expression and pose matching the speaking tone';
  const videoMoodMotion = VIDEO_MOOD_MOTION[mood] || 'camera movement and pacing matching the speaking tone';
  const videoVoiceTone = VIDEO_VOICE_TONE[mood] || 'expressive narration voice matching the speaking tone';

  // Gender voiceover for video prompts (voice only, not visual)
  const genderVoiceover = voiceGender === 'male'
    ? 'male voiceover narration'
    : 'female voiceover narration';

  // Character rules
  let characterRules = '';
  if (hasCharacters && characters.length > 0) {
    const charList = characters.map((c, i) => `- ฉากที่ ${i + 1}: ${c.name} — ${c.desc || 'ตัวละครหลัก'}`).join('\n');
    characterRules = `
## ตัวละครที่กำหนด (1 ฉาก = 1 ตัวละคร)
${charList}
⚠️ **กฎสำคัญ: 1 ฉาก มีแค่ 1 ตัวละครเท่านั้น!**
- แต่ละฉากมีตัวละครเพียงตัวเดียวพูดคนเดียวตลอด 8 วินาที
- ห้ามให้ตัวละครหลายตัวพูดสลับกันในฉากเดียวกัน
- ตัวละครในฉากนั้นเป็นผู้พูดคนเดียว เล่าเรื่อง/ให้ข้อมูลจากมุมมองของตัวเอง
- บทพูดต้องจบครบในฉาก ห้ามตัดจบกลางประโยค
- **พูดเหมือนคนจริงๆ** ใช้ภาษาพูดไม่ใช่ภาษาเขียน ใส่คำอุทาน คำเชื่อม ให้มีชีวิตชีวา
- Image Prompt ต้องระบุลักษณะตัวละครของฉากนั้นชัดเจน
- **⚠️ ตัวละครใน Image Prompt ต้องตรงกับชื่อที่ตั้ง! ถ้าชื่อเป็นผลไม้/อาหาร/สิ่งของ → ต้องเป็นสิ่งนั้นมีชีวิต (มีแขนขา หน้าตา) ไม่ใช่คนจริง!**
  - เช่น ชื่อ "ส้มโอ" → Pixar 3D pomelo fruit character with arms, legs and face
  - เช่น ชื่อ "แตงกวา" → cute cucumber character with expressive face
  - เช่น ชื่อ "วิตามินซี" → vitamin C capsule character with arms and legs
  - ❌ ห้ามสร้างเป็นคนธรรมดาที่ถือผลไม้/อาหาร! ต้องเป็นผลไม้/อาหารที่มีชีวิตเอง!
- **บุคลิกตัวละครต้องสอดคล้องกับสไตล์บทพูด**: ${characterPersonality}`;
  } else {
    characterRules = `
## ตัวละคร
- AI จะคิดตัวละครเป็นสิ่งของมีชีวิต (เช่น ผัก ผลไม้ วิตามิน ที่มีแขนขาและอารมณ์)
- ตัวละครต้องสอดคล้องกับหัวข้อเรื่อง
- **บุคลิกตัวละครต้องสอดคล้องกับสไตล์บทพูด**: ${characterPersonality}`;
  }

  // Realistic mode additions
  const realisticNote = isRealisticMode ? `
⚠️ **โหมด Realistic**:
- Image Prompt ต้องระบุ "photorealistic, natural lighting, high detail, 8K"
- ห้ามใช้คำว่า cartoon, anime, 3D render
- Video Prompt ต้องระบุ "realistic movement, natural motion"
- สไตล์ภาพจะถูกล็อคเป็น Realistic/Cinematic
- **⚠️ บทพูดต้องสั้นกระชับ พูดจบใน 8 วินาทีเท่านั้น**: 25-35 คำต่อฉาก จะกี่ประโยคก็ได้ ห้ามอธิบายยาว
- Video Prompt ต้องระบุ "background narration, voiceover only, character does NOT move lips" — ตัวละครไม่อ้าปากพูด ใช้เสียงบรรยายพื้นหลังแทน` : '';

  const prompt = `คุณเป็นเจ้าของคอนเทนต์ที่เขียนเรื่องราวน่าชนะใจและน่ากระตุ้นอารมณ์
สร้าง Storyboard สำหรับเนื้อหาที่ทำให้คนอยากรู้อยากเห็น
เนื้อหาต้องเปิดแรงจากฉากแรก ดึงดูดให้คนหยุดดู

## สไตล์ภาพ
${styleDesc}

## โทนเสียง
${moodDesc}

## กลุ่มเป้าหมาย
${audienceDesc}
${voiceStyleNote}
${characterRules}
${realisticNote}

## โครงสร้าง Storyboard
⚠️⚠️⚠️ **บังคับ: ต้องสร้าง scenes array ให้มีครบ ${sceneCount} object** — ห้ามน้อยกว่านี้! ถ้าขอ 3 ฉาก ต้องมี 3 scene objects!
⚠️ **1 ตัวละคร = 1 ฉาก (8 วินาที)** — แต่ละฉากมีตัวละครเดียวพูด
- ทุกฉาก: ตัวละครพูดเนื้อหาตรงๆ เลย ไม่ต้องมี label/prefix (ห้ามขึ้นด้วย "Hook:" หรือคำนำอื่นๆ)
- ฉากที่ไม่มีสินค้า: ไม่มี CTA — จบที่เนื้อหาเลย ไม่ต้องชวนติดตาม/แชร์ — ❌ ห้ามพูดชื่อสินค้าของฉากอื่นเด็ดขาด! พูดแค่เนื้อหาตามหัวข้อเท่านั้น
- ฉากที่มีสินค้า: ปิดท้ายด้วย CTA แบบเนียนๆ (ดูรายละเอียดในหัวข้อ "ตั้งค่าแต่ละฉาก")
- แต่ละฉากจบครบในตัว ไม่ต้องต่อเนื่องกัน
- **⚠️ บทพูดต้องตรงสไตล์โทนเสียงที่เลือก 100% สมชื่อเลย** — ถ้าโทนหยาบคาย ต้องหยาบจริงๆ ใช้คำด่า/มึง/กู/ว่ะ/โว้ย เต็มที่ | ถ้าดุดัน ต้องดุจริง กระแทกจริง | ถ้าตลก ต้องขำจริง | ถ้าจริงจัง ต้องจริงจังเต็มที่ | **ห้ามเบาลง ห้ามสุภาพกว่าที่สไตล์กำหนด**

## กฎสำคัญ
1. ทุกฉากต้องมี Image Prompt ภาษาอังกฤษเท่านั้น ที่บอก:
   - สไตล์ภาพ
   - ตัวละคร + อารมณ์ + ท่าทาง (ตัวละครต้องตรงกับชื่อ/ลักษณะที่กำหนด)
   - ฉาก/Background
   - มุมกล้อง
   - **⚠️ ตัวละครต้องตรงกับชื่อตัวละครของฉากนั้น** — ถ้าชื่อเป็นผลไม้/อาหาร/สิ่งของ ต้องเป็นสิ่งนั้นมีชีวิต (มีแขนขา หน้าตา อารมณ์) ไม่ใช่คนจริง! เช่น ตัวละคร "ส้มโอ" → ส้มโอตัวกลมมีแขนขา, "แตงกวา" → แตงกวามีชีวิต
   - **⚠️ ห้ามสร้างภาพเป็นคนจริง/คนธรรมดา** ยกเว้นชื่อตัวละครระบุชัดว่าเป็นคน (เช่น "พี่ส้ม", "หมอมะนาว")
   - **⚠️ ต้องสะท้อนอารมณ์ตามสไตล์บทพูด**: ${imageMoodVisual}
   ${isRealisticMode ? '- photorealistic, natural lighting, high detail' : ''}

2. ทุกฉากต้องมี Video Prompt ภาษาอังกฤษที่บอก:
   - **⚠️ การเคลื่อนไหวต้องสอดคล้องกับสไตล์บทพูด**: ${videoMoodMotion}
   - **⚠️ เสียงบรรยาย**: ${sceneConfigs.length > 0 && sceneConfigs.some(c => c.voiceGender && c.voiceGender !== sceneConfigs[0]?.voiceGender) ? 'ใช้เพศตามที่กำหนดในแต่ละฉาก (male/female voiceover ตามฉาก)' : `ต้องเป็น${gender.thai}: ${genderVoiceover}`}
   - **⚠️ โทนเสียงต้องสอดคล้องกับสไตล์บทพูด**: ${videoVoiceTone}
   - ต้องมี "voiceover narration" หรือ "background narration"
   ${isRealisticMode ? '- realistic movement, natural motion\n   - **⚠️ CRITICAL: character must NOT move lips or speak on screen — use background voiceover/narration ONLY, character performs actions silently**' : ''}

3. เพศผู้พากย์:
${sceneConfigs.length > 0 && sceneConfigs.some(c => c.voiceGender && c.voiceGender !== sceneConfigs[0]?.voiceGender)
  ? `   - ⚠️ **แต่ละฉากมีเพศต่างกัน** — ใช้คำลงท้ายตามที่กำหนดในแต่ละฉาก (ดูรายละเอียดใน "ตั้งค่าแต่ละฉาก")
   - ฉากที่กำหนดเป็นผู้หญิง → ใช้ ค่ะ, นะคะ
   - ฉากที่กำหนดเป็นผู้ชาย → ใช้ ครับ, นะครับ`
  : `   - ${effectiveGender.rule}
   - **สำคัญมาก**: ต้องใช้คำลงท้ายตามที่ระบุในทุกฉาก!`}

4. **⚠️ Image/Video Prompt ต้องสอดคล้องกับเนื้อหาบทพูด (scriptTH)**:
   - Image Prompt ต้องแสดงสิ่งที่บทพูดกำลังเล่า เช่น ถ้าบทพูดเรื่องมะเขือเทศ → ภาพต้องมีตัวละครมะเขือเทศ, ถ้าพูดเรื่องพริก → ภาพต้องมีพริก
   - Image Prompt ต้องแสดงอารมณ์ตามบทพูด เช่น ถ้าบทด่า → หน้าโกรธ ชี้นิ้ว, ถ้าบทตื่นเต้น → หน้าตื่นเต้น ตาโต
   - Video Prompt ต้องมีจังหวะตามบทพูด เช่น ถ้าบทพูดเร็วเร่งเร้า → camera เร็ว dynamic, ถ้าบทพูดช้าสงบ → camera ช้า gentle
   - ห้ามสร้าง Image/Video Prompt ที่ไม่เกี่ยวกับเนื้อหาบทพูดในฉากนั้น

5. **CONTENT POLICY — Image/Video Prompt ต้องปลอดภัย**
   - ห้ามคำรุนแรง: blood, violent, weapon, kill, naked, drug ฯลฯ
   - ใช้แทน: "stern expression", "frustrated face", "pointing gesture"
   - ภาพ/วิดีโอต้องน่ารัก/ตลก แม้บทพูดจะหยาบ
   - Voiceover = เสียงบรรยายพื้นหลัง ไม่ใช่คนในคลิปพูด
   - คำลงท้าย: ${effectiveGender.endings}

6. แต่ละฉากห้ามใช้คำเปิด/โครงสร้าง/คำปิดซ้ำกัน

## ตอบกลับเป็น JSON เท่านั้น
**⚠️ ทุกฉากต้องมีครบ 4 บท: scriptTH, scriptHowTo, scriptChoose, scriptMistake — คนละมุม ห้ามซ้ำ!**
ตัวอย่างที่ถูก (ทุกฉากต้องมีครบ 4 บทแบบนี้):
"scriptTH": "ส้มมีวิตามินซีสูงมากกินวันละลูกภูมิคุ้มกันพุ่งขึ้นทันที ดีกว่ากินวิตามินเม็ดอีก แถมมีใยอาหารช่วยระบบย่อยอาหารได้ดีด้วยนะ!"
"scriptHowTo": "ปอกเปลือกออกก่อนแล้วแบ่งเป็นกลีบกัดทีละกลีบน้ำส้มจะไม่กระเด็นเลอะหน้า แช่ตู้เย็นก่อนกินสักชั่วโมงรสชาติดีขึ้นเท่าตัวเลย!"
"scriptChoose": "เลือกซื้อส้มต้องจับดูหนักมือผิวเนียนเรียบ ถ้ายกขึ้นมาเบาข้างในแห้งแน่นอน ลูกผิวหยาบอย่าเอาเพราะจะเปรี้ยวจนหน้าบูดเลย!"
"scriptMistake": "อย่าเก็บส้มนอกตู้เย็นมันจะเน่าเร็วมาก อย่าคั้นน้ำส้มทิ้งไว้ข้ามคืนวิตามินซีสลายหมด ต้องกินสดถึงจะได้ประโยชน์จริงๆ!"
❌ ผิด: 4 บทเนื้อหาเหมือนกัน / ฉากไหนขาดบท / copy template
{
  "title": "หัวข้อเรื่อง",
  "characters": [
    {
      "name": "ชื่อตัวละคร",
      "appearance": "ลักษณะ/ความเป็นตัวตน"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "characterName": "ชื่อตัวละครของฉากนี้",
      "title": "ชื่อฉาก (EN)",
      "description": "คำอธิบายฉาก (TH)",
      "imagePrompt": "Detailed image prompt (EN only) - MUST start with style: ${styleDesc}, character matching characterName (living object with arms/legs/face if food/fruit/object, NOT human), mood expression/pose (${imageMoodVisual}), scene, lighting. If scene has product WITHOUT separate character: the product itself IS the character — the product comes alive with cute cartoon eyes, mouth, arms, and legs (e.g. bed sheets = a living bed sheet with face/arms/legs, car = a living car with eyes and mouth like Pixar Cars). If scene has product WITH separate character: the character holds/displays the product prominently in hand, product must match the uploaded ingredient photo exactly",
      "videoPrompt": "Movement & voiceover prompt (EN only) - camera: ${videoMoodMotion}, voice: ${videoVoiceTone}, ${genderVoiceover}. MUST include: no text, no subtitles, no captions, no written words on screen",
      "scriptTH": "บทพูด25-35คำพอดี8วิ ประโยชน์/ข้อดีของcharacterName${isCrudeMode ? ' (กู/มึง ห้ามสุภาพ)' : ''}",
      "scriptHowTo": "บทพูด25-35คำพอดี8วิ วิธีใช้/กินcharacterName${isCrudeMode ? ' (กู/มึง ห้ามสุภาพ)' : ''}",
      "scriptChoose": "บทพูด25-35คำพอดี8วิ วิธีเลือก/ซื้อcharacterName${isCrudeMode ? ' (กู/มึง ห้ามสุภาพ)' : ''}",
      "scriptMistake": "บทพูด25-35คำพอดี8วิ ข้อผิดพลาดที่คนทำกับcharacterName${isCrudeMode ? ' (กู/มึง ห้ามสุภาพ)' : ''}"
    }
  ]
}

**สำคัญ:** scenes ครบ ${sceneCount} ฉาก | ทุกฉากต้องมีครบ scriptTH+scriptHowTo+scriptChoose+scriptMistake | บทพูดตรงกับหัวข้อ | ข้อมูลจริง 100%

## วิธีเขียนบทพูด
- **บทพูดต้องสอดคล้องกับหัวข้อเรื่องที่ผู้ใช้กำหนด** — พูดเรื่องที่เกี่ยวข้องกับหัวข้อเท่านั้น ห้ามออกนอกเรื่อง
- ข้อมูลต้องจริง 100% ห้ามแต่งเอง
- ทุกฉากต้องมี: สรรพคุณ/ข้อดีจริง + วิธีที่ถูกต้อง
- **⚠️ ความยาวพอดี 8 วินาที**: 25-35 คำต่อบท จะกี่ประโยคก็ได้ ขอแค่พูดจบพอดี 8 วิ
- แต่ละฉากห้ามใช้คำเปิด/โครงสร้าง/คำปิดซ้ำกัน
- ห้ามตัดจบกลางประโยค ต้องพูดจบครบ
${isCrudeMode ? `
**โหมดหยาบคาย — Explosive Rage เดือดดาล พร้อมปะทะ**

ทุกฉากต้องครบ: ด่า/ตำหนิ + สรรพคุณจริง + วิธีที่ถูกต้อง

**น้ำเสียง:** สั้น กระชับ สั่งการ กระแทกกระทั้น โทษและดูถูกอีกฝ่ายทันที
**สรรพนาม:** กู/มึง เท่านั้น ใช้ ไอ้/อี นำหน้าชื่อ — ห้าม ผม/ฉัน/คุณ/เธอ/ครับ/ค่ะ เด็ดขาด
**คำลงท้าย:** วะ, โว้ย, สิ, ไง หรือพูดห้วนๆ ไม่มีหางเสียง — ห้าม ครับ/ค่ะ/คะ/จ้า
**คำกริยาแรง:** พูด→พล่าม/เห่า กิน→แดก/ยัด ไป→ไสหัว ยุ่ง→เสือก ดู→จ้อง โง่→ทึ่ม/ปัญญาอ่อน
**เทคนิค:** ใช้คำถามไม่ต้องการคำตอบ เช่น "มึงเกิดมาไม่มีสมองเหรอวะ?" "ใครสอนมึงมาวะ?"

ตัวอย่าง:
- "ไอ้ทึ่ม! มึงแดกส้มทั้งเปลือกได้ยังไงวะ ส้มมันมีวิตามินซีสูงนะไอ้โง่ ปอกแล้วแบ่งกลีบแดกสิ ถึงจะได้รสหวานจริงๆ ไง!"
- "อี่บ้า กูเห็นมึงยัดกล้วยทั้งหวีแล้วอยากเห่าจริงๆ โว้ย! กล้วยมีโพแทสเซียมช่วยกล้ามเนื้อ ลอกเปลือกแล้วหักครึ่งก่อนสิวะ เนื้อมันจะนุ่มกว่าเยอะ!"` : ``}`;

  return prompt;
}

// ============================================================
// v15 STORY MODE USER PROMPT
// ============================================================

/**
 * สร้าง User Prompt สำหรับ Story Mode
 * @param {Object} config
 * @param {string} config.topic - หัวข้อ/เนื้อเรื่อง
 * @param {string} config.details - รายละเอียดเพิ่มเติม
 * @param {number} config.sceneCount - จำนวนฉาก
 * @param {boolean} config.isRealisticMode - โหมด Realistic
 * @param {boolean} config.hasCharacters - มีตัวละครหรือไม่
 * @param {Array} config.characters - [{name, desc}]
 * @param {Object} config.product - {name, asProp, mentionInScript, mentionTiming}
 * @param {boolean} config.noTextOverlay - ไม่ต้องมีข้อความบนภาพ
 * @param {Object} config.coverText - {enabled, text, position, color}
 * @param {string} config.language - 'th' or 'en'
 * @returns {string} User prompt
 */
function buildStoryModeUserPrompt(config) {
  const {
    topic,
    details = '',
    sceneCount = 4,
    isRealisticMode = false,
    hasCharacters = false,
    characters = [],
    product = null,
    noTextOverlay = false,
    coverText = null,
    language = 'th',
    sceneConfigs = [],
    mood = ''
  } = config;

  const crudeMoods = ['viral_roast', 'crude', 'aggressive', 'troll', 'scolding', 'isan_crude', 'southern_crude', 'northern_crude'];
  const isCrudeMode = crudeMoods.includes(mood);

  let prompt = `สร้าง Storyboard ${sceneCount} ฉาก เรื่อง: ${topic}`;

  if (details) {
    prompt += `\n${details}`;
  }

  if (isRealisticMode) {
    prompt += `\n\n⚠️ **โหมด Realistic**: สร้างภาพ/วิดีโอสไตล์คนจริง สัตว์จริง เหมือนถ่ายจริง ห้ามเป็นการ์ตูน`;
  }

  // Per-scene configuration (product/character per scene)
  if (sceneConfigs.length > 0) {
    prompt += `\n\n## ตั้งค่าแต่ละฉาก (ต้องใช้ตามที่กำหนดเท่านั้น):`;
    sceneConfigs.forEach((cfg, i) => {
      const sceneNum = i + 1;
      const hasProduct = cfg.product;
      const hasChar = cfg.charName || cfg.charImage;

      const hasGender = cfg.voiceGender;
      if (hasProduct || hasChar || hasGender) {
        prompt += `\n\n### ฉากที่ ${sceneNum}:`;
        if (hasProduct) {
          prompt += `\n- สินค้า (ข้อมูลดิบ): "${cfg.product}"`;
          prompt += `\n- ⚠️ **ชื่อสินค้าสำหรับบทพูด**: ดึงเฉพาะชื่อสินค้าสั้นๆ ที่พูดได้เป็นธรรมชาติจากข้อมูลด้านบน — ห้ามเอาโค้ด/#/ตัวเลขรหัส/ไซส์/shop ID/URL มาใส่ในบทพูด! เช่น ถ้าข้อมูลดิบคือ "#056#L-5XL#กางเกงผู้ชายกีฬา..." → ชื่อที่ใช้พูด = "กางเกงกีฬา"`;
          if (hasChar) {
            prompt += `\n- ⚠️ imagePrompt ของฉากนี้: ตัวละครถือ/โชว์สินค้า "${cfg.product}" ในมือให้เด่นชัด — สินค้าต้องเหมือนรูปต้นฉบับ 100% (character holding/displaying the product "${cfg.product}" prominently in hand, product must match the uploaded ingredient photo EXACTLY — same packaging, same label, same colors, do NOT alter)`;
          } else {
            prompt += `\n- ⚠️ imagePrompt ของฉากนี้: สินค้าคือตัวละครเลย! — สินค้า "${cfg.product}" กลายเป็นสิ่งมีชีวิต มีตา ปาก แขน ขา เหมือนการ์ตูน (เช่น ผ้าปูที่นอน=ผ้าปูมีชีวิตมีหน้าตาแขนขา, รถยนต์=รถมีตามีปากพูดได้แบบ Pixar Cars, ขวดแชมพู=ขวดมีชีวิตมีหน้ามีแขนขา) ต้องจำได้ทันทีว่าเป็นสินค้าอะไร (the product "${cfg.product}" IS the character — it comes alive as a cute cartoon with eyes, mouth, arms, legs. Must be clearly recognizable as that actual product. Product appearance must match the uploaded ingredient photo — same shape, same colors, same packaging)`;
          }
          if (cfg.productHighlights) {
            prompt += `\n- จุดเด่น/รายละเอียดสินค้า: ${cfg.productHighlights}`;
          }
          prompt += `\n- ⚠️ บทพูดต้องสอดคล้องกับหัวข้อเรื่อง "${topic}" + สินค้านี้ ${cfg.productHighlights ? '+ รายละเอียด "' + cfg.productHighlights + '"' : ''} — เชื่อมโยงเนื้อหากับสินค้าให้เป็นธรรมชาติ`;
          prompt += `\n- ⚠️⚠️ ทุกบท (scriptTH, scriptHowTo, scriptChoose, scriptMistake) ต้องเอ่ยชื่อสินค้า (ชื่อสั้นๆ ที่ดึงมา) อย่างน้อย 1 ครั้งในบทพูด! ห้ามพูดลอยๆ โดยไม่เอ่ยชื่อ! ห้ามเอาโค้ด/รหัส/ตัวเลข/URL มาพูด!`;
          prompt += `\n- แต่ละบทต้องครบ 3 ส่วน:`;
          prompt += `\n  1) เล่าเนื้อหาที่เกี่ยวกับหัวข้อ + สินค้า — เชื่อมโยงให้เป็นธรรมชาติ${cfg.productHighlights ? ' โดยใช้ข้อมูล: ' + cfg.productHighlights : ''}`;
          prompt += `\n  2) บอกจุดเด่น/ข้อดี — ${cfg.productHighlights ? 'อ้างอิงจากรายละเอียดที่ให้มา: ' + cfg.productHighlights : 'คิดจุดเด่นให้น่าสนใจ'}`;
          prompt += `\n  3) CTA ปิดท้ายแบบเนียนๆ — ห้ามขายตรง! ใช้แนวแนะนำส่วนตัว/ชวนลอง เช่น:`;
          prompt += `\n     ✅ "ลองดูสิ ใช้แล้วจะรู้" / "ใครสนใจลองหาดูนะ" / "เราว่าน่าลองมากๆ" / "ใครยังไม่เคยลองน่าเสียดายมาก"`;
          prompt += `\n     ✅ "ตัวนี้โอเคมากจริงๆ" / "ใช้มาแล้วบอกเลยว่าคุ้ม" / "ของดีต้องบอกต่อ"`;
          prompt += `\n     ❌ ห้าม: "ซื้อเลย/สั่งเลย/กดลิงก์/โค้ดส่วนลด/ราคาพิเศษ/จำนวนจำกัด/โปรวันนี้เท่านั้น"`;
          prompt += `\n     ❌ ห้ามพูดเรื่องราคา ส่วนลด โปรโมชัน ลิงก์ โค้ด — เสี่ยงผิดกฎ TikTok`;
          prompt += `\n  ⚠️ ทั้ง 3 ส่วนต้องอยู่ในฉากเดียวนี้ พูดจบภายใน 8 วินาที`;
        }
        if (cfg.charName) {
          prompt += `\n- ตัวละคร: "${cfg.charName}"`;
          if (cfg.charDesc) prompt += ` - ${cfg.charDesc}`;
        }
        if (cfg.charImage && !cfg.charName) {
          prompt += `\n- ตัวละคร: ดูจากรูปที่แนบ (ฉากที่ ${sceneNum})`;
        }
        if (hasGender) {
          const resolvedGender = cfg.voiceGender === 'random' ? (Math.random() < 0.5 ? 'female' : 'male') : cfg.voiceGender;
          const g = GENDER_RULES[resolvedGender] || GENDER_RULES.female;
          prompt += `\n- เพศผู้พากย์: ${g.thai} (คำลงท้าย: ${g.endings})`;
        }
      }
    });
    prompt += `\n\n**สำคัญ**: แต่ละฉากต้องใช้สินค้า/ตัวละครตามที่กำหนดไว้ข้างบน`;
  } else if (hasCharacters && characters.length > 0) {
    // Fallback to old character system — ระบุฉากให้ชัดเจน
    prompt += `\n\n## ตัวละครที่กำหนด (ต้องใช้ตามฉากที่ระบุ):`;
    characters.forEach((c, i) => {
      prompt += `\n- ฉากที่ ${i + 1}: "${c.name}" — ${c.desc || 'ตัวละครหลัก'}`;
    });
    prompt += `\n\n⚠️ **สำคัญมาก**: แต่ละฉากต้องพูดเรื่องของตัวละคร/หัวข้อที่กำหนดไว้เท่านั้น`;
    prompt += `\n- ฉากที่ 1 ต้องพูดเรื่อง "${characters[0]?.name}" ห้ามพูดเรื่องอื่น`;
    if (characters.length > 1) prompt += `\n- ฉากที่ 2 ต้องพูดเรื่อง "${characters[1]?.name}" ห้ามพูดเรื่องอื่น`;
    if (characters.length > 2) prompt += `\n- ฉากที่ 3 ต้องพูดเรื่อง "${characters[2]?.name}" ห้ามพูดเรื่องอื่น`;
    if (characters.length > 3) {
      for (let ci = 3; ci < characters.length; ci++) {
        prompt += `\n- ฉากที่ ${ci + 1} ต้องพูดเรื่อง "${characters[ci]?.name}" ห้ามพูดเรื่องอื่น`;
      }
    }
  }

  if (product && product.name && sceneConfigs.length === 0) {
    // Only use old product system if no sceneConfigs
    prompt += `\n\n## สินค้า/สปอนเซอร์:`;
    prompt += `\n- ชื่อ: ${product.name}`;
    if (product.asProp) prompt += `\n- วางสินค้าเป็น prop ในฉาก`;
    if (product.mentionInScript) {
      const timingMap = { start: 'ต้นคลิป', middle: 'กลางคลิป', end: 'ท้ายคลิป' };
      prompt += `\n- พูดถึงในบทพากย์ช่วง ${timingMap[product.mentionTiming] || 'ท้ายคลิป'}`;
    }
  }

  if (noTextOverlay) {
    prompt += `\n\n⚠️ ห้ามมีตัวอักษร/ข้อความบนภาพและวิดีโอทุกฉาก (no text overlay)`;
  }

  if (coverText && coverText.enabled) {
    prompt += `\n\n## ตัวหนังสือปกคลิป (ฉากแรกเท่านั้น):`;
    if (coverText.text) prompt += `\n- ข้อความ: "${coverText.text}"`;
    else prompt += `\n- บอทจะแต่งจากชื่อเรื่องอัตโนมัติ`;
    if (coverText.position) prompt += `\n- ตำแหน่ง: ${coverText.position}`;
    if (coverText.color) prompt += `\n- คู่สี: ${coverText.color}`;
  }

  prompt += `\n\n## 🎯 แนวทางเขียนบทพูด:`;
  prompt += `\n- แต่ละฉากต้องเปิด/ปิดต่างกัน ห้ามใช้โครงสร้างซ้ำ — AI คิดเองว่าจะเปิด/ปิดยังไง`;
  prompt += `\n- 25-35 คำต่อบท (พอดี 8 วิ) จะกี่ประโยคก็ได้`;
  prompt += `\n- ทุกฉากต้องมีครบ 4 บท! scriptTH=ประโยชน์ scriptHowTo=วิธีใช้ scriptChoose=วิธีเลือก scriptMistake=ข้อผิดพลาด — ห้ามขาดฉากไหน!`;
  prompt += `\n🚫 ห้ามใส่วงเล็บ/label ในบทพูด — เขียนบทพูดจริงเลย!`;

  if (isCrudeMode) {
    prompt += `\n\n🔥🔥🔥 **ย้ำอีกครั้ง — โหมดหยาบคาย**:`;
    prompt += `\n- ทุกฉากต้องมีครบ 3 อย่าง: (1) ด่า/ตำหนิ (2) สรรพคุณ/ข้อดี (3) วิธีที่ถูกต้อง — ขาดอย่างใดอย่างหนึ่ง = ผิด!`;
    prompt += `\n- ห้ามมีคำว่า ครับ ค่ะ นะครับ นะคะ นะค่ะ จ้า คะ ในบทพูดเด็ดขาด!`;
    prompt += `\n- ห้ามมีคำว่า ผม ฉัน คุณ เธอ — ใช้ กู/มึง เท่านั้น!`;
    prompt += `\n- ถ้าพบคำสุภาพแม้แต่คำเดียว = ผิด!`;
  }

  if (language === 'en') {
    prompt += `\n\n**IMPORTANT**: All Script text must be written in English. Title and descriptions in English.`;
  }

  // ย้ำเรื่องชื่อสินค้าตอนท้ายสุด (ให้น้ำหนักสูงสุด)
  if (sceneConfigs.length > 0) {
    const scenesWithProduct = sceneConfigs
      .map((cfg, i) => ({ sceneNum: i + 1, product: cfg.product }))
      .filter(s => s.product);
    if (scenesWithProduct.length > 0) {
      prompt += `\n\n🔴🔴🔴 **ย้ำสำคัญที่สุด — ชื่อสินค้าในบทพูด**:`;
      scenesWithProduct.forEach(s => {
        prompt += `\n- ฉาก ${s.sceneNum}: ดึงชื่อสินค้าสั้นๆ จาก "${s.product}" (เอาแค่ชื่อที่พูดได้ ห้ามเอาโค้ด/รหัส/#/ตัวเลขมา)`;
      });
      prompt += `\n- ทุกบท (scriptTH, scriptHowTo, scriptChoose, scriptMistake) ของฉากที่มีสินค้า ต้องเอ่ยชื่อสินค้าในบทพูดอย่างน้อย 1 ครั้ง!`;
      prompt += `\n- ❌ ถ้าบทไหนไม่มีชื่อสินค้า = ผิด! ต้องพูดชื่อจริงๆ ไม่ใช่แค่พูดลอยๆ ว่า "ตัวนี้" / "อันนี้"`;
      prompt += `\n- ❌❌ ฉากที่ไม่ได้กำหนดสินค้าไว้ข้างบน ห้ามเอ่ยชื่อสินค้าเด็ดขาด! พูดเฉพาะเนื้อหาตามหัวข้อเท่านั้น`;
    }
  }

  return prompt;
}

// ============================================================
// v13 PRODUCT STORYBOARD PROMPT (สำรอง)
// ============================================================

/**
 * สร้าง System Prompt สำหรับ Product Storyboard (v13)
 */
function buildProductStoryboardSystemPrompt(config) {
  const { style = 'product_showcase', sceneCount = 4, hasModel = false } = config;

  const styleDesc = PRODUCT_STYLE_MAP[style] || PRODUCT_STYLE_MAP.product_showcase;

  return `คุณคือผู้เชี่ยวชาญการสร้าง Storyboard สำหรับวิดีโอโฆษณาสินค้า
วิเคราะห์รูปสินค้าและสร้าง Storyboard ${sceneCount} ฉาก

สไตล์ที่ต้องการ: ${styleDesc}
${hasModel ? 'มีนายแบบ/นางแบบในคลิป' : 'เป็นคลิปสินค้าอย่างเดียว ใช้ FX effects'}

กฎการสร้าง:
1. วิเคราะห์รูปสินค้า: วัสดุ, รูปร่าง, สี, texture
2. ${hasModel ? 'ฉากมีคน: คนถือ/ใช้สินค้า, แสดงอารมณ์' : 'ฉากสินค้าอย่างเดียว: ใช้ FX zoom, rotate, particle effects'}
3. สร้าง Photo Prompt (TH+EN) สำหรับสร้างภาพ
4. สร้าง Video Prompt (EN) สำหรับ animate ภาพ
5. สร้าง Voiceover Script (TH) สำหรับเสียงพากย์พื้นหลัง (ไม่ใช่ lip-sync)

⚠️ Voiceover ต้องเป็นเสียงบรรยายพื้นหลัง ไม่ใช่คนในคลิปพูด
⚠️ Video Prompt ต้องระบุ "background narration voice" หรือ "voiceover" ไม่ใช่ "talking" หรือ "speaking"

ตอบกลับเป็น JSON เท่านั้น:
{
  "productAnalysis": {
    "material": "วัสดุ",
    "shape": "รูปร่าง",
    "colors": ["สี1", "สี2"],
    "texture": "พื้นผิว"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "คำอธิบายฉาก",
      "photoPrompt": "Photo prompt ภาษาไทย + English",
      "videoPrompt": "Video prompt in English only (include: background narration voice OR voiceover)",
      "voiceover": "บทพากย์ภาษาไทยที่เป็นธรรมชาติ พูดสบายๆ"
    }
  ]
}`;
}

function buildProductStoryboardUserPrompt(productName, hasModel) {
  return `สินค้า: ${productName}
${hasModel ? 'รูปที่ 1 = สินค้า, รูปที่ 2 = นายแบบ/นางแบบ (ถ้ามี)' : 'รูป = สินค้า (ไม่มีนายแบบ ใช้ FX effects)'}

สร้าง Storyboard ให้หน่อย`;
}

// ============================================================
// OPENAI API CALL
// ============================================================

/**
 * Parse JSON-stringified values stored by useLocalStorage hook
 */
function parseStoredKey(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return '';
  try {
    return JSON.parse(raw) || '';
  } catch {
    return raw;
  }
}

/**
 * Get OpenAI/OpenRouter API configuration
 * Priority: OpenAI > OpenRouter
 */
function getOpenAIConfig() {
  const openaiKey = parseStoredKey('openaiKey');
  const openRouterKey = parseStoredKey('openRouterKey');

  if (openaiKey && openaiKey.trim()) {
    return {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: openaiKey.trim()
    };
  } else if (openRouterKey && openRouterKey.trim()) {
    return {
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-4o-mini',
      apiKey: openRouterKey.trim()
    };
  }
  return null;
}

/**
 * เรียก OpenAI/OpenRouter API
 * @param {string} systemPrompt - System instruction
 * @param {string} userPrompt - User message
 * @param {Array<string>} images - Array of base64 data URLs
 * @param {Object} options
 * @returns {Promise<string>} AI response text
 */
async function callOpenAI(systemPrompt, userPrompt, images = [], options = {}) {
  const { temperature = 0.95, maxTokens = 4096 } = options;

  const config = getOpenAIConfig();
  if (!config) {
    throw new Error('กรุณาตั้งค่า OpenAI หรือ OpenRouter API Key ใน Settings');
  }

  console.log('[OpenAI API] Provider:', config.provider, 'Model:', config.model);
  console.log('[OpenAI API] Key length:', config.apiKey.length, 'First 6:', config.apiKey.substring(0, 6));

  // Build messages
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // User message with optional images
  if (images.length > 0) {
    const content = [];
    for (const imageDataUrl of images) {
      if (imageDataUrl && imageDataUrl.includes('base64,')) {
        content.push({
          type: 'image_url',
          image_url: { url: imageDataUrl, detail: 'low' }
        });
      }
    }
    content.push({ type: 'text', text: userPrompt });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://triple-bot.app';
    headers['X-Title'] = 'Triple Bot';
  }

  // Build request body
  const requestBody = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  };

  // Add response-healing plugin for OpenRouter to auto-fix malformed JSON
  if (config.provider === 'openrouter') {
    requestBody.plugins = [{ id: 'response-healing' }];
  }

  // Timeout 90 วินาที — ถ้า API ค้างจะ abort แทนที่จะรอ forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`${config.provider} API ไม่ตอบสนองภายใน 90 วินาที — กรุณาลองใหม่`);
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message ||
      errorData.message ||
      `${config.provider} API error: ${response.status}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
  console.log('[OpenAI API] finish_reason:', finishReason, '| content length:', content.length);
  if (!content) {
    console.error('[OpenAI API] Empty response! Full data:', JSON.stringify(data).substring(0, 500));
  }
  return content;
}

// ============================================================
// GEMINI TTS API
// ============================================================

const GEMINI_TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';

// Voice mapping: voiceType → Gemini voice name
const GEMINI_VOICE_MAP = {
  'male-teen': 'Puck',
  'male-young': 'Puck',
  'male-adult': 'Kore',
  'male-elder': 'Enceladus',
  'male-deep': 'Enceladus',
  'male-high': 'Puck',
  'male-energetic': 'Fenrir',
  'male-calm': 'Charon',
  'male-presenter': 'Kore',
  'male-narrator': 'Orus',
  'female-teen': 'Leda',
  'female-young': 'Zephyr',
  'female-adult': 'Aoede',
  'female-elder': 'Aoede',
  'female-sweet': 'Leda',
  'female-clear': 'Zephyr',
  'female-energetic': 'Zephyr',
  'female-soft': 'Aoede',
  'female-presenter': 'Aoede',
  'female-narrator': 'Aoede',
};

/**
 * Get Gemini voice name from voice type
 */
function getGeminiVoice(voiceType) {
  return GEMINI_VOICE_MAP[voiceType] || 'Kore';
}

/**
 * Convert PCM base64 audio to WAV blob URL
 */
function convertPcmToWav(pcmBase64, sampleRate = 24000) {
  // Decode base64 to binary
  const binaryString = atob(pcmBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const pcmData = bytes;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // Create WAV header
  const wavHeaderSize = 44;
  const wavBuffer = new ArrayBuffer(wavHeaderSize + pcmData.length);
  const view = new DataView(wavBuffer);

  // Helper to write string
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, pcmData.length, true);

  // Write PCM data
  const wavBytes = new Uint8Array(wavBuffer);
  wavBytes.set(pcmData, wavHeaderSize);

  // Create blob URL
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

// Speaking styles that need special voice/tone
const SPEAKING_STYLE_VOICE_OVERRIDE = {
  'viral_roast': {
    prefix: '[พูดด้วยน้ำเสียงดุดัน หยาบคาย เหมือนด่า แต่ตลก เน้นเสียงดัง เร็ว กระแทก ว้ากใส่คนฟัง] '
  },
  'crude': {
    prefix: '[พูดด้วยน้ำเสียงหยาบคายดิบ ดุร้าย เสียงดัง ตะคอก เหมือนด่าจริงๆ กระแทกทุกคำ โมโห] '
  },
  'aggressive': {
    prefix: '[พูดด้วยน้ำเสียงดุดันรุนแรง เสียงดังฟาดๆ กระแทก จริงจัง ข่มขู่ เหมือนพี่ใหญ่สั่ง] '
  },
  'scolding': {
    prefix: '[พูดด้วยน้ำเสียงดุ สอนด่า เหมือนแม่ดุลูก บ่นจี้ เสียงแหลมขึ้น เน้นคำสำคัญ] '
  },
  'troll': {
    prefix: '[พูดด้วยน้ำเสียงกวนตีน เหน็บแนม ยิ้มแกล้ง เสียงลากยาว เหมือนแซวเพื่อน] '
  },
  'isan_crude': {
    prefix: '[พูดด้วยสำเนียงอีสาน น้ำเสียงดุดัน หยาบ เสียงดัง ตะคอก กระแทก] '
  },
  'southern_crude': {
    prefix: '[พูดด้วยสำเนียงใต้ น้ำเสียงดุดัน หยาบ เสียงดัง เร็ว ดุร้าย กระแทก] '
  },
  'northern_crude': {
    prefix: '[พูดด้วยสำเนียงเหนือ/คำเมือง น้ำเสียงดุดัน หยาบ เสียงดัง กระแทก] '
  }
};

/**
 * Generate speech audio using Gemini TTS with retry logic for rate limits
 * @param {Object} config
 * @param {string} config.text - Text to speak
 * @param {string} config.voiceType - Voice type (e.g., 'female-young', 'male-adult')
 * @param {string} config.apiKey - Gemini API Key
 * @param {number} config.maxRetries - Max retry attempts (default: 3)
 * @param {string} config.speakingStyle - Speaking style (e.g., 'viral_roast')
 * @returns {Promise<{success: boolean, audioUrl?: string, error?: string}>}
 */
async function generateSpeech(config) {
  const { text, voiceType, apiKey, maxRetries = 3, speakingStyle } = config;

  if (!apiKey) {
    return { success: false, error: 'Gemini API Key is required' };
  }

  if (!text) {
    return { success: false, error: 'Text is required' };
  }

  // Get voice from user selection (always respect user's choice)
  let voiceName = getGeminiVoice(voiceType);
  let ttsText = text;

  // Check for speaking style - only add prefix, don't override voice
  const styleOverride = SPEAKING_STYLE_VOICE_OVERRIDE[speakingStyle];
  if (styleOverride?.prefix) {
    ttsText = styleOverride.prefix + text;
    console.log('[Gemini TTS] Using style prefix for:', speakingStyle);
  }

  console.log('[Gemini TTS] User selected voice:', voiceType, '→', voiceName, '| Text length:', ttsText.length);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(GEMINI_TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ttsText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;

        // Check for rate limit (429 or quota exceeded)
        if (response.status === 429 || errorMessage.includes('quota') || errorMessage.includes('rate')) {
          // Extract retry delay from error message (e.g., "retry in 16.888964877s")
          const retryMatch = errorMessage.match(/retry in (\d+\.?\d*)s/i);
          let waitTime = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) : (attempt + 1) * 20000;
          waitTime = Math.min(waitTime, 60000); // Max 60 seconds

          if (attempt < maxRetries) {
            console.log(`[Gemini TTS] Rate limit hit, waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}...`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
        }

        return { success: false, error: errorMessage };
      }

      const data = await response.json();
      const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

      if (!audioData || !audioData.data) {
        return { success: false, error: 'No audio data in response' };
      }

      const audioUrl = convertPcmToWav(audioData.data, 24000);
      return { success: true, audioUrl };
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[Gemini TTS] Error, retrying ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

// ============================================================
// GEMINI API CALL (Backup)
// ============================================================

/**
 * เรียก Gemini API พร้อมรูปภาพ
 * @param {string} apiKey - Gemini API Key
 * @param {string} systemPrompt - System instruction
 * @param {string} userPrompt - User message
 * @param {Array<string>} images - Array of base64 data URLs (data:image/png;base64,...)
 * @param {Object} options
 * @param {string} options.model - Model name (default: gemini-2.0-flash-exp)
 * @param {number} options.temperature - Temperature (default: 0.7)
 * @param {number} options.maxOutputTokens - Max tokens (default: 4096)
 * @returns {Promise<string>} AI response text
 */
async function callGeminiWithImages(apiKey, systemPrompt, userPrompt, images = [], options = {}) {
  const {
    model = 'gemini-2.0-flash-exp',
    temperature = 0.7,
    maxOutputTokens = 4096
  } = options;

  // Trim API key และลบ quotes ที่อาจติดมา
  const cleanApiKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');

  // Debug log
  console.log('[Gemini API] Model:', model);
  console.log('[Gemini API] Key length:', cleanApiKey.length, 'First 6:', cleanApiKey.substring(0, 6));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;

  // Build content parts (images first, then text)
  const parts = [];

  for (const imageDataUrl of images) {
    if (imageDataUrl && imageDataUrl.includes('base64,')) {
      const base64Data = imageDataUrl.split('base64,')[1];
      const mimeType = imageDataUrl.split(':')[1].split(';')[0];
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }
  }

  parts.push({ text: userPrompt });

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        parts: parts
      }
    ],
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: maxOutputTokens
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('Gemini API Error: ' + errorText);
  }

  const responseJson = await response.json();

  if (responseJson.error) {
    throw new Error('Gemini Error: ' + responseJson.error.message);
  }

  return responseJson.candidates[0].content.parts[0].text;
}

/**
 * เรียก Gemini API แบบ text only (ไม่มีรูป)
 */
async function callGemini(apiKey, systemPrompt, userPrompt, options = {}) {
  return callGeminiWithImages(apiKey, systemPrompt, userPrompt, [], options);
}

// ============================================================
// PARSE STORYBOARD RESPONSE
// ============================================================

/**
 * Parse JSON จาก AI response
 * @param {string} text - Raw AI response text
 * @returns {Object} Parsed storyboard data
 */
function convertScriptFieldsToArray(storyboard) {
  if (storyboard && storyboard.scenes) {
    storyboard.scenes.forEach(scene => {
      const howTo = scene.scriptHowTo || scene.script2;
      const choose = scene.scriptChoose || scene.script3;
      const mistake = scene.scriptMistake || scene.script4;

      // สร้าง scriptVariations เสมอ — ไม่ว่า AI จะส่งมาครบหรือไม่
      scene.scriptVariations = [
        scene.scriptTH || '',
        howTo || '',
        choose || '',
        mistake || ''
      ];
      delete scene.scriptHowTo;
      delete scene.scriptChoose;
      delete scene.scriptMistake;
      delete scene.script2;
      delete scene.script3;
      delete scene.script4;

      const missing = [];
      if (!howTo) missing.push('scriptHowTo');
      if (!choose) missing.push('scriptChoose');
      if (!mistake) missing.push('scriptMistake');
      if (missing.length > 0) {
        console.warn(`[StoryboardAI] Scene ${scene.sceneNumber}: AI ไม่ส่ง ${missing.join(', ')} — บทนั้นจะว่างเปล่า`);
      } else {
        console.log('[StoryboardAI] Converted scriptHowTo/Choose/Mistake → scriptVariations for scene', scene.sceneNumber);
      }
    });
  }
  return storyboard;
}

function parseStoryboardResponse(text) {
  console.log('[StoryboardAI] Response length:', text?.length || 0, '| First 200 chars:', (text || '').substring(0, 200));
  if (!text || text.trim().length === 0) {
    throw new Error('AI ตอบกลับว่าง (empty response) — อาจเป็นปัญหา API Key หรือ Model');
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI ไม่ตอบกลับ JSON ที่ถูกต้อง: ' + text.substring(0, 300));

  let raw = jsonMatch[0];

  // ลอง parse ตรงๆ ก่อน
  try {
    return convertScriptFieldsToArray(JSON.parse(raw));
  } catch (e) {
    console.log('[StoryboardAI] JSON parse failed, trying repair...', e.message);
  }

  // Repair Level 1: Basic fixes
  raw = raw.replace(/,\s*([\]}])/g, '$1'); // ลบ trailing commas
  raw = raw.replace(/\.{3,}/g, ''); // ลบ ...
  raw = raw.replace(/[\x00-\x1F\x7F]/g, ' '); // ลบ control characters

  try {
    return convertScriptFieldsToArray(JSON.parse(raw));
  } catch (e2) {
    console.log('[StoryboardAI] Repair Level 1 failed, trying Level 2...', e2.message);
  }

  // Repair Level 2: Fix incomplete arrays in scriptVariations (backward compat)
  raw = raw.replace(/"scriptVariations"\s*:\s*\[([^\]]*?)(\]|\})/g, (match, content, ending) => {
    const items = content.split(/",\s*"/).length;
    if (items < 4 && ending === '}') {
      return `"scriptVariations": [${content}"]`;
    }
    return match;
  });

  // Repair Level 3: Fix unescaped quotes in strings
  raw = raw.replace(/:(\s*)"([^"]*?)(?<!\\)"([^,\}\]]*?)"/g, ':$1"$2\\"$3"');

  try {
    return convertScriptFieldsToArray(JSON.parse(raw));
  } catch (e3) {
    console.error('[StoryboardAI] JSON repair failed:', e3.message);
    console.error('[StoryboardAI] Raw JSON (first 1000 chars):', raw.substring(0, 1000));
    throw new Error('AI ตอบ JSON ไม่ถูกต้อง: ' + e3.message);
  }
}

// ============================================================
// MAIN: GENERATE STORYBOARD
// ============================================================

/**
 * สร้าง Storyboard จากการตั้งค่า
 * @param {Object} config - ค่าจากฟอร์ม
 * @param {string} config.apiKey - Gemini API Key
 * @param {string} config.topic - หัวข้อ
 * @param {string} config.details - รายละเอียดเพิ่มเติม
 * @param {string} config.style - สไตล์ภาพ
 * @param {string} config.mood - โทนเสียง
 * @param {string} config.targetAudience - กลุ่มเป้าหมาย
 * @param {number} config.sceneCount - จำนวนฉาก
 * @param {string} config.aspectRatio - สัดส่วน
 * @param {string} config.voiceGender - เพศผู้พากย์
 * @param {boolean} config.isRealisticMode - โหมด Realistic
 * @param {boolean} config.hasCharacters - ใช้ตัวละครหรือไม่
 * @param {Array} config.characters - [{name, desc, image (base64 data URL)}]
 * @param {Object} config.product - สินค้า {name, image, asProp, mentionInScript, mentionTiming}
 * @param {boolean} config.noTextOverlay
 * @param {Object} config.coverText - {enabled, text, position, color}
 * @param {string} config.language - 'th' or 'en'
 * @returns {Promise<Object>} Storyboard data
 */
async function generateStoryboard(config) {
  const { topic } = config;

  if (!topic) throw new Error('กรุณาใส่หัวข้อ/เนื้อเรื่อง');

  // Check if OpenAI/OpenRouter is available
  const openaiConfig = getOpenAIConfig();
  if (!openaiConfig) {
    throw new Error('กรุณาตั้งค่า OpenAI หรือ OpenRouter API Key ใน Settings');
  }

  const systemPrompt = buildStoryModeSystemPrompt(config);
  const userPrompt = buildStoryModeUserPrompt(config);

  // Collect images to send
  const images = [];

  // Add images from sceneConfigs (per-scene characters)
  if (config.sceneConfigs && config.sceneConfigs.length > 0) {
    config.sceneConfigs.forEach((cfg, i) => {
      if (cfg.charImage) {
        images.push(cfg.charImage);
        console.log(`[StoryMode] Added image from scene ${i + 1}`);
      }
    });
  } else {
    // Fallback to old character images
    if (config.characters) {
      config.characters.forEach(c => {
        if (c.image) images.push(c.image);
      });
    }
  }

  // Add product image (old system)
  if (config.product && config.product.image) {
    images.push(config.product.image);
  }

  console.log('[StoryMode] Calling OpenAI with', images.length, 'images');

  const expectedScenes = config.sceneCount || 4;
  const maxRetries = 2;

  // คำนวณ maxTokens ตามจำนวนฉาก (1 ฉาก × 4 บท × ภาษาไทย ≈ 2000 tokens)
  const dynamicMaxTokens = Math.min(16384, Math.max(8192, expectedScenes * 2000));
  console.log('[StoryMode] Using maxTokens:', dynamicMaxTokens, 'for', expectedScenes, 'scenes');

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const responseText = await callOpenAI(systemPrompt, userPrompt, images, { maxTokens: dynamicMaxTokens });
      const storyboard = parseStoryboardResponse(responseText);

      const actualScenes = storyboard.scenes?.length || 0;
      console.log('[StoryMode] Storyboard generated:', storyboard.title, '-', actualScenes, 'scenes (expected:', expectedScenes, ')');

      // Validate scene count
      if (actualScenes >= expectedScenes) {
        return storyboard;
      }

      // Scene count mismatch
      lastError = new Error(`AI สร้างไม่ครบ ${expectedScenes} ฉาก (ได้แค่ ${actualScenes} ฉาก) - กรุณาลองใหม่`);
      console.warn(`[StoryMode] Scene count mismatch: expected ${expectedScenes}, got ${actualScenes}. Attempt ${attempt + 1}/${maxRetries + 1}`);
    } catch (err) {
      lastError = err;
      console.warn(`[StoryMode] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, err.message);
    }

    if (attempt < maxRetries) {
      console.log('[StoryMode] Retrying storyboard generation...');
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastError || new Error('สร้าง Storyboard ล้มเหลว — กรุณาลองใหม่');
}

// ============================================================
// AUTO-FIX POLICY VIOLATION PROMPT
// ============================================================

/**
 * แก้ไข Image Prompt ที่ถูก policy violation โดยใช้ AI
 * @param {string} originalPrompt - Prompt เดิมที่เกิด error
 * @param {string} errorMessage - Error message จาก API (ถ้ามี)
 * @returns {Promise<string>} - Prompt ที่ปลอดภัยขึ้น
 */
async function fixPolicyViolationPrompt(originalPrompt, errorMessage = '') {
  const config = getOpenAIConfig();
  if (!config) {
    console.warn('[PolicyFix] No API key available, returning original prompt');
    return originalPrompt;
  }

  console.log('[PolicyFix] Attempting to fix policy violation...');
  console.log('[PolicyFix] Original:', originalPrompt.substring(0, 100) + '...');

  const systemPrompt = `You are an expert at rewriting image generation prompts to be safe and comply with content policies.

TASK: Rewrite the given image prompt to be safer while preserving the core visual intent.

RULES:
1. Remove or replace any potentially problematic content:
   - Violence, weapons, blood → peaceful alternatives
   - Sexual/suggestive content → modest, appropriate descriptions
   - Hate symbols, slurs → neutral descriptions
   - Real celebrities/politicians → generic character descriptions
   - Dangerous activities → safe alternatives
2. Keep the scene composition, style, and mood intact
3. Preserve technical details like aspect ratio, camera angle, lighting
4. Keep the prompt in the same language as the original
5. Make the description detailed enough to generate a good image

OUTPUT: Return ONLY the rewritten prompt, nothing else.`;

  const userPrompt = `Original prompt that caused policy violation:
"${originalPrompt}"

${errorMessage ? `Error received: "${errorMessage}"` : ''}

Rewrite this prompt to be safe and policy-compliant:`;

  try {
    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    };

    if (config.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://triple-bot.app';
      headers['X-Title'] = 'Triple Bot';
    }

    const requestBody = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_completion_tokens: 500
    };

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const fixedPrompt = data.choices?.[0]?.message?.content?.trim() || '';

    if (fixedPrompt) {
      console.log('[PolicyFix] Fixed prompt:', fixedPrompt.substring(0, 100) + '...');
      return fixedPrompt;
    }

    return originalPrompt;
  } catch (err) {
    console.error('[PolicyFix] Failed to fix prompt:', err);
    return originalPrompt;
  }
}

/**
 * ตรวจสอบว่า error message เป็น policy violation หรือไม่
 * @param {string} errorMessage - Error message
 * @returns {boolean}
 */
function isPolicyViolationError(errorMessage) {
  if (!errorMessage) return false;
  const lowerMsg = errorMessage.toLowerCase();
  const policyKeywords = [
    'policy',
    'content policy',
    'safety',
    'inappropriate',
    'violat',
    'blocked',
    'not allowed',
    'harmful',
    'offensive',
    'prohibited',
    'restricted',
    'nsfw',
    'sensitive',
    'flagged'
  ];
  return policyKeywords.some(keyword => lowerMsg.includes(keyword));
}

// ============================================================
// EXPORTS
// ============================================================

// For use in Chrome Extension popup
if (typeof window !== 'undefined') {
  window.StoryboardAI = {
    generateStoryboard,
    buildStoryModeSystemPrompt,
    buildStoryModeUserPrompt,
    buildProductStoryboardSystemPrompt,
    buildProductStoryboardUserPrompt,
    callOpenAI,
    getOpenAIConfig,
    callGeminiWithImages,
    callGemini,
    parseStoryboardResponse,
    // Policy Fix
    fixPolicyViolationPrompt,
    isPolicyViolationError,
    // TTS
    generateSpeech,
    getGeminiVoice,
    GEMINI_VOICE_MAP,
    // Mappings (for UI dropdowns)
    IMAGE_STYLE_MAP,
    MOOD_MAP,
    VOICE_STYLE_MAP,
    AUDIENCE_MAP,
    GENDER_RULES,
    PRODUCT_STYLE_MAP
  };
}

// For Node.js / module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateStoryboard,
    buildStoryModeSystemPrompt,
    buildStoryModeUserPrompt,
    buildProductStoryboardSystemPrompt,
    buildProductStoryboardUserPrompt,
    callGeminiWithImages,
    callGemini,
    parseStoryboardResponse,
    IMAGE_STYLE_MAP,
    MOOD_MAP,
    VOICE_STYLE_MAP,
    AUDIENCE_MAP,
    GENDER_RULES,
    PRODUCT_STYLE_MAP
  };
}
