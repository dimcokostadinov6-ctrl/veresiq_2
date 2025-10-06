import vision from '@google-cloud/vision';
import cors from 'cors';

const corsMw = cors({ origin: true });
const client = new vision.ImageAnnotatorClient(); // ползва default creds на Cloud

// парсване "Име - сума" с тире/двоеточие, кирилица + латиница, десет. запетая
function parseNameAmounts(text) {
  const results = [];
  const norm = s => (s || '').normalize('NFC').replace(/[–—−]/g, '-');
  const lines = norm(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const rxGlobal = /([A-Za-zА-Яа-яЁёЇїІіЄєЪъЬьҐґЩщЧчЮюЯяЙйШшЦцЖжЩщЪЬ\s'’.·\-]{2,50})\s*[-=:]\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/gu;
  for (const raw of lines) {
    let m;
    while ((m = rxGlobal.exec(raw)) !== null) {
      const name = m[1].replace(/[^\p{L}\s'’.-]/gu, ' ').replace(/\s+/g, ' ').trim();
      const amt = parseFloat(String(m[2]).replace(',', '.'));
      if (name && Number.isFinite(amt)) results.push({ name, amount: +amt.toFixed(2) });
    }
  }
  return results;
}

// HTTP функция: POST JSON { image: "<dataURL|base64>" }
export const ocr = async (req, res) => {
  corsMw(req, res, async () => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

      let { image } = req.body || {};
      if (!image) return res.status(400).json({ error: 'Missing image' });

      // приемаме dataURL или чист base64
      const base64 = image.startsWith('data:')
        ? image.split(',')[1]
        : image;
      const buffer = Buffer.from(base64, 'base64');

      // Vision OCR (documentTextDetection е по-добро за ръкопис)
      const [result] = await client.documentTextDetection({
        image: { content: buffer },
        imageContext: {
          languageHints: ['bg', 'ru', 'en'] // български приоритет
        }
      });

      const text = result?.fullTextAnnotation?.text || '';
      const entries = parseNameAmounts(text);

      res.json({ ok: true, text, entries });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });
};
