import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const upload = multer({
  limits: { fileSize: 12 * 1024 * 1024 }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, "public")));

function num(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[^0-9.+-]/g, "")
  );

  return Number.isFinite(n) ? n : null;
}

function calculateSignal(data) {
  const rsi = num(data.rsi);
  const k = num(data.stochK);
  const d = num(data.stochD);
  const macd = num(data.macd);
  const macdSignal = num(data.macdSignal);

  let score = 0;
  const reasons = [];

  // RSI
  if (rsi !== null) {
    if (rsi <= 30) {
      score += 2;
      reasons.push(`RSI ${rsi}: 과매도권`);
    } else if (rsi < 45) {
      score += 1;
      reasons.push(`RSI ${rsi}: 낮은 구간`);
    } else if (rsi >= 70) {
      score -= 2;
      reasons.push(`RSI ${rsi}: 과매수권`);
    } else if (rsi > 60) {
      score -= 1;
      reasons.push(`RSI ${rsi}: 높은 구간`);
    } else {
      reasons.push(`RSI ${rsi}: 중립권`);
    }
  }

  // Stochastic
  if (k !== null && d !== null) {
    if (k < 20 && d < 20 && k > d) {
      score += 2;
      reasons.push(`스토캐스틱 K ${k} / D ${d}: 과매도권 상승`);
    } else if (k > 80 && d > 80 && k < d) {
      score -= 2;
      reasons.push(`스토캐스틱 K ${k} / D ${d}: 과매수권 하락`);
    } else if (k > 80) {
      score -= 1;
      reasons.push(`스토캐스틱 K ${k}: 과매수 구간`);
    } else if (k < 20) {
      score += 1;
      reasons.push(`스토캐스틱 K ${k}: 과매도 구간`);
    } else if (k > d) {
      score += 1;
      reasons.push(`스토캐스틱 K ${k} > D ${d}`);
    } else if (k < d) {
      score -= 1;
      reasons.push(`스토캐스틱 K ${k} < D ${d}`);
    }
  }

  // MACD
  if (macd !== null && macdSignal !== null) {
    if (macd > macdSignal) {
      score += 2;
      reasons.push(`MACD ${macd} > Signal ${macdSignal}`);
    } else if (macd < macdSignal) {
      score -= 2;
      reasons.push(`MACD ${macd} < Signal ${macdSignal}`);
    }
  }

  let signal = "관망";

  if (score >= 4) {
    signal = "매수 후보";
  } else if (score >= 2) {
    signal = "약한 매수 후보";
  } else if (score <= -4) {
    signal = "매도 후보";
  } else if (score <= -2) {
    signal = "약한 매도 후보";
  }

  return {
    score,
    signal,
    reasons
  };
}

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "이미지가 없습니다."
      });
    }

    const mime = req.file.mimetype || "image/jpeg";

    const imageData =
      `data:${mime};base64,${req.file.buffer.toString("base64")}`;

    const ticker = (req.body.ticker || "").toUpperCase();
    const timeframe = req.body.timeframe || "";

    const prompt = `
미국 주식 기술적 차트 스크린샷에서 정보를 추출한다.

사용자가 입력한 종목: ${ticker}
사용자가 입력한 시간봉: ${timeframe}

중요:
- 이미지에서 실제로 읽을 수 있는 정보만 반환한다.
- 숫자가 보이지 않으면 null을 반환한다.
- 추측해서 숫자를 만들지 않는다.
- 매수 또는 매도 판단은 하지 않는다.
- confidence는 투자 성공 확률이 아니라 이미지 판독 신뢰도다.

다음을 추출한다.

ticker
price
rsi
stochK
stochD
macd
macdSignal
trend
support
resistance
invalidation
confidence

반드시 JSON만 출력한다.

{
  "ticker": "",
  "price": null,
  "rsi": null,
  "stochK": null,
  "stochD": null,
  "macd": null,
  "macdSignal": null,
  "trend": "",
  "support": "",
  "resistance": "",
  "invalidation": "",
  "confidence": 0
}
`;

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      reasoning: { effort: "low" },

      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_image",
              image_url: imageData,
              detail: "high"
            }
          ]
        }
      ]
    });

    let text = response.output_text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const extracted = JSON.parse(text);

    const technical = calculateSignal(extracted);

    const result = {
      ...extracted,

      ticker: extracted.ticker || ticker,

      signal: technical.signal,

      score: technical.score,

      reasons: technical.reasons
    };

    res.json(result);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "AI 분석 중 오류가 발생했습니다.",
      detail: error?.message || String(error)
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Stock Signal AI v3 running on port ${PORT}`);
});
