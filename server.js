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

function roundPrice(value) {
  if (value === null || !Number.isFinite(value)) return null;

  if (value < 10) return Number(value.toFixed(2));
  if (value < 100) return Number(value.toFixed(2));
  return Number(value.toFixed(2));
}


// ===============================
// 기술적 지표 점수 계산
// ===============================

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
      reasons.push(
        `스토캐스틱 K ${k} / D ${d}: 과매도권 상승`
      );

    } else if (k > 80 && d > 80 && k < d) {

      score -= 2;
      reasons.push(
        `스토캐스틱 K ${k} / D ${d}: 과매수권 하락`
      );

    } else if (k > 80) {

      score -= 1;
      reasons.push(
        `스토캐스틱 K ${k}: 과매수 구간`
      );

    } else if (k < 20) {

      score += 1;
      reasons.push(
        `스토캐스틱 K ${k}: 과매도 구간`
      );

    } else if (k > d) {

      score += 1;
      reasons.push(
        `스토캐스틱 K ${k} > D ${d}`
      );

    } else if (k < d) {

      score -= 1;
      reasons.push(
        `스토캐스틱 K ${k} < D ${d}`
      );
    }
  }


  // MACD
  if (macd !== null && macdSignal !== null) {

    if (macd > macdSignal) {

      score += 2;

      reasons.push(
        `MACD ${macd} > Signal ${macdSignal}`
      );

    } else if (macd < macdSignal) {

      score -= 2;

      reasons.push(
        `MACD ${macd} < Signal ${macdSignal}`
      );
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



// ===============================
// V4 매매 계획 계산
// ===============================

function calculateTradePlan(data, technical) {

  const price = num(data.price);
  const support = num(data.support);
  const resistance = num(data.resistance);

  if (price === null) {

    return {
      entryStatus: "판단 불가",
      entryCandidate: null,
      target1: null,
      stopLoss: null,
      riskLevel: "판단 불가",
      strategy: "현재가를 판독할 수 없어 매매 계획을 계산하지 못했습니다."
    };
  }


  let entryStatus = "대기";
  let entryCandidate = null;
  let target1 = null;
  let stopLoss = null;
  let riskLevel = "보통";
  let strategy = "추가 확인이 필요합니다.";


  // -------------------------------
  // 진입 후보가
  // -------------------------------

  if (support !== null && support < price) {

    const distance =
      (price - support) / price;

    // 지지선이 너무 멀면
    // 현재가의 3% 아래를 1차 관찰구간으로 사용
    if (distance > 0.15) {

      entryCandidate =
        roundPrice(price * 0.97);

    } else {

      // 지지선보다 약간 위
      entryCandidate =
        roundPrice(
          support +
          (price - support) * 0.20
        );
    }

  } else {

    entryCandidate =
      roundPrice(price * 0.97);
  }


  // -------------------------------
  // 목표가
  // -------------------------------

  if (
    resistance !== null &&
    resistance > price
  ) {

    target1 = roundPrice(resistance);

  } else {

    target1 =
      roundPrice(price * 1.05);
  }


  // -------------------------------
  // 손절 기준
  // -------------------------------

  if (
    support !== null &&
    support < price
  ) {

    stopLoss =
      roundPrice(support * 0.97);

  } else {

    stopLoss =
      roundPrice(price * 0.95);
  }


  // -------------------------------
  // 위험도
  // -------------------------------

  if (
    resistance !== null &&
    resistance > price
  ) {

    const resistanceDistance =
      (resistance - price) / price;


    if (resistanceDistance <= 0.03) {

      riskLevel = "높음";

    } else if (resistanceDistance <= 0.07) {

      riskLevel = "보통";

    } else {

      riskLevel = "낮음";
    }
  }


  // -------------------------------
  // 최종 전략
  // -------------------------------

  if (
    resistance !== null &&
    resistance > price &&
    (resistance - price) / price <= 0.03
  ) {

    entryStatus = "추격매수 주의";

    strategy =
      `현재가가 저항선 ${resistance}에 근접했습니다. ` +
      `저항 돌파 확인 또는 눌림목을 기다리는 전략이 유리합니다.`;

  }

  else if (technical.score >= 4) {

    entryStatus = "매수 후보";

    strategy =
      `기술적 지표가 강한 매수 후보입니다. ` +
      `진입 후보가 부근에서 지지 여부를 확인하는 전략입니다.`;

  }

  else if (technical.score >= 2) {

    entryStatus = "분할매수 관찰";

    strategy =
      `상승 신호가 있으나 강하지 않습니다. ` +
      `진입 후보가 부근에서 분할 접근을 검토할 수 있습니다.`;

  }

  else if (technical.score <= -2) {

    entryStatus = "매수 보류";

    strategy =
      `기술적 약세 신호가 우세합니다. ` +
      `추가 하락 여부를 확인할 때까지 신규 진입을 보류하는 전략입니다.`;

  }

  else {

    entryStatus = "관망";

    strategy =
      `신호가 혼재되어 있습니다. ` +
      `현재가 추격보다 진입 후보가 또는 저항 돌파 여부를 기다립니다.`;
  }


  return {
    entryStatus,
    entryCandidate,
    target1,
    stopLoss,
    riskLevel,
    strategy
  };
}



// ===============================
// 이미지 분석 API
// ===============================

app.post(
  "/api/analyze",
  upload.single("image"),

  async (req, res) => {

    try {

      if (!req.file) {

        return res.status(400).json({
          error: "이미지가 없습니다."
        });
      }


      const mime =
        req.file.mimetype ||
        "image/jpeg";


      const imageData =
        `data:${mime};base64,${req.file.buffer.toString("base64")}`;


      const ticker =
        (req.body.ticker || "")
        .toUpperCase();


      const timeframe =
        req.body.timeframe || "";


      const prompt = `

미국 주식 기술적 차트 스크린샷에서 정보를 추출한다.

사용자가 입력한 종목:
${ticker}

사용자가 입력한 시간봉:
${timeframe}


중요 규칙:

- 이미지에서 실제로 읽을 수 있는 정보만 반환한다.
- 숫자가 명확하지 않으면 null을 반환한다.
- 숫자를 추측해서 만들지 않는다.
- 매수 또는 매도 판단은 하지 않는다.
- confidence는 투자 성공 확률이 아니라 이미지 판독 신뢰도다.
- 미국 주식 가격이 달러로 표시되어 있으면 숫자만 반환한다.
- support와 resistance도 숫자로 명확히 확인되는 경우에만 반환한다.
- 차트에 표시된 명확한 저점 또는 고점 가격 표기가 있으면 support/resistance로 사용할 수 있다.


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
  "support": null,
  "resistance": null,
  "invalidation": null,
  "confidence": 0
}

`;


      const response =
        await openai.responses.create({

          model:
            process.env.OPENAI_MODEL ||
            "gpt-5.6-luna",

          reasoning: {
            effort: "low"
          },

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


      let text =
        response.output_text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/```$/i, "")
        .trim();


      const extracted =
        JSON.parse(text);


      const technical =
        calculateSignal(extracted);


      const tradePlan =
        calculateTradePlan(
          extracted,
          technical
        );


      const result = {

        ...extracted,

        ticker:
          extracted.ticker ||
          ticker,

        signal:
          technical.signal,

        score:
          technical.score,

        reasons:
          technical.reasons,

        tradePlan
      };


      res.json(result);


    } catch (error) {

      console.error(error);

      res.status(500).json({

        error:
          "AI 분석 중 오류가 발생했습니다.",

        detail:
          error?.message ||
          String(error)

      });

    }
  }
);



const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  "0.0.0.0",

  () => {

    console.log(
      `Stock Signal AI V4 running on port ${PORT}`
    );

  }
);
