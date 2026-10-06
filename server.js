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
  return Number(value.toFixed(2));
}

function roundPercent(value) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
}


// ==========================================
// 기술적 지표 점수
// ==========================================

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


// ==========================================
// V5 위험관리 / 매매계획
// ==========================================

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

      targetSource: "계산 불가",
      stopSource: "계산 불가",

      expectedGainPct: null,
      expectedLossPct: null,
      riskReward: null,

      riskLevel: "판단 불가",
      tradeQuality: "판단 불가",

      strategy:
        "현재가를 판독할 수 없어 위험관리 계산을 할 수 없습니다."
    };
  }


  // ------------------------------------------
  // 1. 진입 후보가
  // ------------------------------------------

  let entryCandidate = null;

  if (support !== null && support < price) {

    const supportDistance =
      (price - support) / price;

    /*
      지지선이 현재가에서 12% 이상 멀면
      해당 지지선을 단기 진입가로 사용하지 않는다.
    */

    if (supportDistance <= 0.12) {

      entryCandidate =
        roundPrice(
          support +
          (price - support) * 0.25
        );

    } else {

      entryCandidate =
        roundPrice(price * 0.97);
    }

  } else {

    entryCandidate =
      roundPrice(price * 0.97);
  }


  // ------------------------------------------
  // 2. 목표가
  // ------------------------------------------

  let target1 = null;
  let targetSource = "";


  if (
    resistance !== null &&
    resistance > price
  ) {

    target1 =
      roundPrice(resistance);

    targetSource =
      "차트 저항선";

  } else {

    /*
      저항선을 읽지 못한 경우
      목표가를 현재가 +5%로 자동 계산.
      화면에서는 반드시 '계산값'이라고 표시한다.
    */

    target1 =
      roundPrice(price * 1.05);

    targetSource =
      "계산값 (+5%)";
  }


  // ------------------------------------------
  // 3. 손절 기준
  // ------------------------------------------

  let stopLoss = null;
  let stopSource = "";


  if (
    support !== null &&
    support < price
  ) {

    const supportDistance =
      (price - support) / price;


    /*
      핵심 변경:
      지지선이 현재가에서 10%보다 멀면
      해당 지지선을 손절가로 사용하지 않는다.
    */

    if (supportDistance <= 0.10) {

      stopLoss =
        roundPrice(support * 0.98);

      stopSource =
        "차트 지지선 기준";

    } else {

      stopLoss =
        roundPrice(price * 0.95);

      stopSource =
        "위험관리 계산값 (-5%)";
    }

  } else {

    stopLoss =
      roundPrice(price * 0.95);

    stopSource =
      "위험관리 계산값 (-5%)";
  }


  // ------------------------------------------
  // 4. 예상 수익률 / 손실률
  // ------------------------------------------

  let expectedGainPct = null;
  let expectedLossPct = null;


  if (target1 !== null) {

    expectedGainPct =
      roundPercent(
        ((target1 - price) / price) * 100
      );
  }


  if (stopLoss !== null) {

    expectedLossPct =
      roundPercent(
        ((price - stopLoss) / price) * 100
      );
  }


  // ------------------------------------------
  // 5. 손익비
  // Reward / Risk
  // ------------------------------------------

  let riskReward = null;


  if (
    expectedGainPct !== null &&
    expectedLossPct !== null &&
    expectedLossPct > 0
  ) {

    riskReward =
      Number(
        (
          expectedGainPct /
          expectedLossPct
        ).toFixed(2)
      );
  }


  // ------------------------------------------
  // 6. 위험도
  // ------------------------------------------

  let riskLevel = "보통";


  if (
    expectedLossPct !== null &&
    expectedLossPct > 7
  ) {

    riskLevel = "높음";

  } else if (
    expectedLossPct !== null &&
    expectedLossPct <= 4
  ) {

    riskLevel = "낮음";
  }


  // ------------------------------------------
  // 7. 매매 적합성
  // ------------------------------------------

  let tradeQuality = "관찰";


  if (riskReward !== null) {

    if (
      riskReward >= 2 &&
      technical.score >= 2
    ) {

      tradeQuality =
        "양호";

    } else if (
      riskReward >= 1.5 &&
      technical.score >= 1
    ) {

      tradeQuality =
        "보통";

    } else {

      tradeQuality =
        "진입 보류";
    }
  }


  // ------------------------------------------
  // 8. 진입 판단
  // ------------------------------------------

  let entryStatus = "관망";


  if (
    resistance !== null &&
    resistance > price
  ) {

    const resistanceDistance =
      (resistance - price) / price;


    if (resistanceDistance <= 0.03) {

      entryStatus =
        "저항 근접 - 추격주의";
    }
  }


  if (
    entryStatus === "관망"
  ) {

    if (
      technical.score >= 4 &&
      tradeQuality !== "진입 보류"
    ) {

      entryStatus =
        "매수 후보";

    } else if (
      technical.score >= 2 &&
      tradeQuality !== "진입 보류"
    ) {

      entryStatus =
        "분할매수 관찰";

    } else if (
      technical.score <= -2
    ) {

      entryStatus =
        "신규매수 보류";

    } else {

      entryStatus =
        "관망";
    }
  }


  // ------------------------------------------
  // 9. 전략 문장
  // ------------------------------------------

  let strategy = "";


  if (
    riskReward !== null &&
    riskReward < 1
  ) {

    strategy =
      `예상 손익비가 ${riskReward}:1로 불리합니다. ` +
      `현재 가격에서 신규 진입보다 더 좋은 가격을 기다리는 편이 유리합니다.`;

  } else if (
    tradeQuality === "진입 보류"
  ) {

    strategy =
      `기술적 신호와 손익비를 함께 고려하면 현재 위치는 신규 진입에 유리하지 않습니다. ` +
      `눌림목 또는 새로운 저항 돌파 확인을 기다립니다.`;

  } else if (
    entryStatus.includes("저항")
  ) {

    strategy =
      `현재가가 차트 저항선에 가깝습니다. ` +
      `추격 진입보다 저항 돌파 확인 또는 눌림목을 기다립니다.`;

  } else if (
    technical.score >= 2
  ) {

    strategy =
      `기술적 상승 신호가 확인됩니다. ` +
      `진입 후보가 부근에서 지지 여부를 확인하고 손절 기준을 지키는 전략입니다.`;

  } else {

    strategy =
      `기술적 신호가 혼재되어 있습니다. ` +
      `현재가 추격보다 진입 후보가 또는 추가 상승 확인을 기다립니다.`;
  }


  return {

    entryStatus,
    entryCandidate,

    target1,
    targetSource,

    stopLoss,
    stopSource,

    expectedGainPct,
    expectedLossPct,

    riskReward,

    riskLevel,
    tradeQuality,

    strategy
  };
}


// ==========================================
// 이미지 분석 API
// ==========================================

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
- 절대로 보이지 않는 숫자를 추측해서 만들지 않는다.
- 매수 또는 매도 판단을 하지 않는다.
- 목표가와 손절가를 임의로 만들지 않는다.
- confidence는 투자 성공 확률이 아니라 이미지 판독 신뢰도다.

- 미국 주식 가격이 달러로 표시되어 있으면 숫자만 반환한다.

- support는 차트에 명확히 표시된 저점 또는 지지 가격을
  실제로 읽을 수 있는 경우에만 숫자로 반환한다.

- resistance는 차트에 명확히 표시된 고점 또는 저항 가격을
  실제로 읽을 수 있는 경우에만 숫자로 반환한다.

- 명확하지 않으면 support 또는 resistance는 null이다.

- invalidation도 이미지에 명시적으로 확인되는 경우에만 반환한다.


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
      `Stock Signal AI V5 running on port ${PORT}`
    );

  }
);
