// === Google Cloud OCR за Вересия (само кирилица) ===
const functions = require('@google-cloud/functions-framework');
const vision = require('@google-cloud/vision');

const client = new vision.ImageAnnotatorClient();

// Обработва само кирилица и числа
function parseBulgarian(text) {
  const results = [];
  const norm = (s) => s.normalize('NFC').replace(/[–—−]/g, '-');
  const rx = /([А-Яа-яЁёЇїІіЄєЪъЬьҐґЩщЧчЮюЯяЙйЁёЪъЬьЩщШшЦцЖжЍѝ\s'’.\-]{2,50})\s*[-=:]\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/gu;

  for (const raw of norm(text || '').split(/\r?\n/)) {
    let m;
    while ((m = rx.exec(raw)) !== null) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      const amt = parseFloat(String(m[2]).replace(',', '.'));
      if (name && isFinite(amt)) results.push({ name, amount: amt });
    }
  }
  return results;
}

// === Главната OCR функция ===
functions.http('ocr', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ ok: false, error: 'Missing image data' });

    // Изпраща изображението към Google Vision
    const [result] = await client.textDetection({ image: { content: image.split(',')[1] } });
    const text = result.fullTextAnnotation?.text || '';
    const entries = parseBulgarian(text);
    res.json({ ok: true, entries });
  } catch (err) {
    console.error('OCR Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ако се стартира ръчно
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  functions.start('ocr', PORT);
  console.log(`Server listening on port ${PORT}`);
}
