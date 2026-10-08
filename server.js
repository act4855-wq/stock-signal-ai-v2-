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
  const volume = num(data.volume);
  const volumeAvg = num(data.volumeAvg);
  const rsi = num(data.rsi);
  const k = num(data.stochK);
  const d = num(data.stochD);
  const macd = num(data.macd);
  const macdSignal = num(data.macdSignal);

  let score = 0;
  const reasons = [];
// Volume
if (
  volume !== null &&
  volumeAvg !== null &&
  volumeAvg > 0
) {
  const volumeRatio = volume / volumeAvg;

  if (volumeRatio >= 1.5) {
    reasons.push(
      `거래량 ${volumeRatio.toFixed(2)}배: 평균 대비 매우 강함`
    );
  } else if (volumeRatio >= 1.2) {
    reasons.push(
      `거래량 ${volumeRatio.toFixed(2)}배: 평균 대비 증가`
    );
  } else if (volumeRatio < 0.8) {
    reasons.push(
      `거래량 ${volumeRatio.toFixed(2)}배: 평균 대비 감소`
    );
  } else {
    reasons.push(
      `거래량 ${volumeRatio.toFixed(2)}배: 평균 수준`
    );
  }
}

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
// V6 위험관리 / 매매계획
// 핵심:
// 예상수익률, 예상손실률, 손익비는
// 현재가가 아니라 "진입 후보가" 기준으로 계산
// ==========================================

function calculateTradePlan(data, technical) {

  const price = num(data.price);
  const atr = num(data.atr);
  const support = num(data.support);
  const resistance = num(data.resistance);
// 비정상 지지선·저항선 방어
let validSupport = support;
let validResistance = resistance;

// 지지선은 현재가보다 낮아야 하며,
// 현재가의 50%보다 지나치게 낮으면 계산에서 제외
if (
  validSupport !== null &&
  (validSupport >= price || validSupport < price * 0.5)
) {
  validSupport = null;
}

// 저항선은 현재가보다 높아야 하며,
// 현재가의 100% 이상 지나치게 높으면 계산에서 제외
if (
  validResistance !== null &&
  (validResistance <= price || validResistance > price * 2)
) {
  validResistance = null;
}
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

      calculationBase: "계산 불가",

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
      지지선이 현재가에서 12% 이내면
      지지선과 현재가 사이의 25% 위치를 진입 후보로 사용.

      지지선이 너무 멀면
      현재가보다 3% 낮은 가격을 관찰 진입 후보로 사용.
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
  validResistance !== null &&
  validResistance > entryCandidate
) {

  target1 =
    roundPrice(validResistance);

    targetSource =
      "차트 저항선";

  } else {

    /*
      저항선을 판독하지 못한 경우에는
      기존 V5와 동일하게 현재가 +5%를
      계산 목표가로 사용한다.
    */

    target1 =
      roundPrice(price * 1.05);

    targetSource =
      "계산값 (현재가 +5%)";
  }


  // ------------------------------------------
  // 3. 손절 기준
  // ------------------------------------------

  let stopLoss = null;
  let stopSource = "";

  const atrStopDistance =
  atr !== null && atr > 0
    ? Math.min(atr * 1.5, entryCandidate * 0.08)
    : null;
  
 if (
  validSupport !== null &&
  validSupport < entryCandidate
) {

  const supportDistanceFromEntry =
    (entryCandidate - validSupport) /
    entryCandidate;


    /*
      지지선이 실제 진입 후보가에서
      10% 이내에 있을 때만
      차트 지지선을 손절 기준으로 사용.
    */

    if (supportDistanceFromEntry <= 0.10) {

      stopLoss =
        roundPrice(validSupport * 0.98);

      stopSource =
        "차트 지지선 기준";

    } else {

    if (atrStopDistance !== null) {
    stopLoss =
        roundPrice(entryCandidate - atrStopDistance);

    stopSource =
        "ATR 기준 (1.5 ATR)";
} else {
    stopLoss =
        roundPrice(entryCandidate * 0.98);

    stopSource =
        "위험관리 계산값 (진입가 -2%)";
}

  } else {

  if (atrStopDistance !== null) {
    stopLoss =
        roundPrice(entryCandidate - atrStopDistance);

    stopSource =
        "ATR 기준 (1.5 ATR)";
} else {
    stopLoss =
        roundPrice(entryCandidate * 0.98);

    stopSource =
        "위험관리 계산값 (진입가 -2%)";
  }


  // ------------------------------------------
  // 4. 예상 수익률
  // 진입 후보가 → 목표가
  // ------------------------------------------

  let expectedGainPct = null;

  if (
    entryCandidate !== null &&
    target1 !== null &&
    target1 > entryCandidate
  ) {

    expectedGainPct =
      roundPercent(
        (
          (target1 - entryCandidate) /
          entryCandidate
        ) * 100
      );
  }


  // ------------------------------------------
  // 5. 예상 손실률
  // 진입 후보가 → 손절가
  // ------------------------------------------

  let expectedLossPct = null;

  if (
    entryCandidate !== null &&
    stopLoss !== null &&
    stopLoss < entryCandidate
  ) {

    expectedLossPct =
      roundPercent(
        (
          (entryCandidate - stopLoss) /
          entryCandidate
        ) * 100
      );
  }


  // ------------------------------------------
  // 6. 손익비
  // Reward / Risk
  // ------------------------------------------

  let riskReward = null;


  if (
    entryCandidate !== null &&
    target1 !== null &&
    stopLoss !== null &&
    target1 > entryCandidate &&
    stopLoss < entryCandidate
  ) {

    const reward =
      target1 - entryCandidate;

    const risk =
      entryCandidate - stopLoss;


    if (risk > 0) {

      riskReward =
        Number(
          (reward / risk).toFixed(2)
        );
    }
  }


  // ------------------------------------------
  // 7. 위험도
  // 실제 진입가 기준 예상손실률 사용
  // ------------------------------------------

  let riskLevel = "보통";


  if (
    expectedLossPct !== null &&
    expectedLossPct > 7
  ) {

    riskLevel = "높음";

  } else if (
    expectedLossPct !== null &&
    expectedLossPct <= 3
  ) {

    riskLevel = "낮음";

  } else {

    riskLevel = "보통";
  }


  // ------------------------------------------
  // 8. 매매 적합성
  // 손익비 + 기술적 점수 결합
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
  // 9. 진입 판단
  // ------------------------------------------

  let entryStatus = "관망";
let validEntryResistance = resistance;

if (
  validEntryResistance !== null &&
  (validEntryResistance <= price || validEntryResistance > price * 1.20)
) {
  validEntryResistance = null;
}

  /*
    현재가가 차트 저항선에 3% 이내로
    접근한 경우에는 추격매수 경고를 우선한다.
  */

 if (
  validEntryResistance !== null &&
  validEntryResistance > price
) {

   const resistanceDistance =
  (validEntryResistance - price) / price;


    if (resistanceDistance <= 0.03) {

      entryStatus =
        "저항 근접 - 추격주의";
    }
  }


  if (entryStatus === "관망") {

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
  // 10. 전략 문장
  // ------------------------------------------

  let strategy = "";


  if (
    riskReward !== null &&
    riskReward < 1
  ) {

    strategy =
      `진입 후보가 ${entryCandidate} 기준 예상 손익비가 ` +
      `${riskReward}:1로 불리합니다. ` +
      `현재 위치에서 신규 진입보다 더 좋은 가격을 기다립니다.`;

  } else if (
    tradeQuality === "진입 보류"
  ) {

    strategy =
      `진입 후보가 ${entryCandidate} 기준 손익비는 ` +
      `${riskReward !== null ? riskReward + ":1" : "계산 불가"}이지만 ` +
      `기술적 신호가 충분하지 않습니다. ` +
      `눌림목 또는 추가 상승 확인을 기다립니다.`;

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
      `진입 후보가 ${entryCandidate} 부근에서 지지를 확인합니다. ` +
      `목표가 ${target1}, 손절 기준 ${stopLoss}, ` +
      `예상 손익비는 ${riskReward !== null ? riskReward + ":1" : "계산 불가"}입니다.`;

  } else {

    strategy =
      `손익비가 양호하더라도 기술적 신호가 아직 강하지 않습니다. ` +
      `현재가 추격보다 진입 후보가 ${entryCandidate} 부근의 가격 움직임을 확인합니다.`;
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

    calculationBase:
      "진입 후보가 기준",

    strategy
  };
}
// ==========================================
// V7 진입 의사결정
// 현재가와 V6 매매계획을 이용하여
// 지금 진입 / 눌림목 대기 / 돌파 대기 / 관망 구분
// ==========================================

function calculateEntryDecision(data, technical, plan) {

  const price = num(data.price);
  const resistance = num(data.resistance);
  const entry = num(plan?.entryCandidate);

  if (price === null || entry === null) {
    return {
      entryDecision: "관망",
      entryDistancePct: null,
      decisionReason:
        "현재가 또는 진입 후보가를 확인할 수 없습니다."
    };
  }

  const entryDistancePct =
    ((price - entry) / price) * 100;

  let entryDecision = "관망";
  let decisionReason =
    "추가적인 가격 움직임을 확인합니다.";

  // 강한 매수 신호
  if (
    technical.score >= 4 &&
    entryDistancePct <= 1
  ) {
    entryDecision = "지금 진입";
    decisionReason =
      "기술적 매수 신호가 강하고 현재가가 진입 후보가에 근접해 있습니다.";
  }

  // 매수 신호는 있으나 진입가까지 기다리는 경우
  else if (
    technical.score >= 2 &&
    entryDistancePct > 1
  ) {
    entryDecision = "눌림목 대기";
    decisionReason =
      `기술적 매수 신호는 있으나 진입 후보가까지 약 ${entryDistancePct.toFixed(1)}%의 가격 조정 여지가 있습니다.`;
  }

  // 상승 추세이나 신호가 아직 약한 경우
  else if (
   technical.score >= 0 &&
   resistance !== null &&
   resistance > price &&
   resistance <= price * 1.20  
  ) {
    entryDecision = "돌파 대기";
    decisionReason =
      "상승 흐름은 유지되고 있으나 기술적 신호가 충분히 강하지 않아 저항선 돌파 여부를 확인합니다.";
  }
// 저항선을 판독하지 못했지만 상승 신호가 남아 있는 경우
else if (
  technical.score >= 1 &&
  (
    resistance === null ||
    resistance <= price ||
    resistance > price * 1.20
  )
) {
  entryDecision = "신호 대기";
  decisionReason =
    "상승 신호가 일부 확인되지만 유효한 저항선을 확인할 수 없어 추가 확인이 필요합니다.";
}
  // 나머지
  else {
    entryDecision = "관망";
    decisionReason =
      "현재 기술적 조건에서는 신규 진입을 서두를 필요가 없습니다.";
  }

  return {
    entryDecision,
    entryDistancePct:
      Number(entryDistancePct.toFixed(1)),
    decisionReason
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

- volume은 차트에 표시된 가장 최근 거래량 값을 숫자로 반환한다.
- 거래량 값이 명확하게 보이지 않으면 volume은 null이다.
- volumeAvg는 차트에 평균 거래량 값이 명확하게 표시된 경우에만 숫자로 반환한다.
- 평균 거래량 값이 표시되지 않거나 명확하지 않으면 volumeAvg는 null이다.

- atr은 차트에 표시된 ATR(14)의 가장 최근 현재값만 숫자로 반환한다.
- ATR 값이 명확하게 보이지 않으면 atr은 null이다.

- support는 차트에 명확히 표시된 저점 또는 지지 가격을
  실제로 읽을 수 있는 경우에만 숫자로 반환한다.

- resistance는 차트에 명확히 표시된 고점 또는 저항 가격을
  실제로 읽을 수 있는 경우에만 숫자로 반환한다.

- 명확하지 않으면 support 또는 resistance는 null이다.

- invalidation도 이미지에 명시적으로 확인되는 경우에만 반환한다.


다음을 추출한다.

ticker
price
volume
volumeAvg
rsi
atr
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
  "volume": null,
  "volumeAvg": null,
  "rsi": null,
  "atr": null,
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
          max_output_tokens: 1000,
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
                  detail: "auto"
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
const entryDecision =
  calculateEntryDecision(
    extracted,
    technical,
    tradePlan
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

     tradePlan,
entryDecision
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
      `Stock Signal AI V6 running on port ${PORT}`
    );

  }
);
