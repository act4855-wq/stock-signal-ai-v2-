import express from "express";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/analyze", upload.single("image"), async (req,res)=>{
 try{
  if(!req.file) return res.status(400).json({error:"이미지가 없습니다."});
  const mime=req.file.mimetype || "image/jpeg";
  const data=`data:${mime};base64,${req.file.buffer.toString("base64")}`;
  const ticker=(req.body.ticker||"").toUpperCase();
  const timeframe=req.body.timeframe||"";

  const prompt=`미국주식 기술적 차트 스크린샷을 분석한다.
사용자가 지정한 종목: ${ticker}, 시간봉: ${timeframe}.
이미지에서 실제로 읽을 수 있는 것만 반환하라. 숫자가 흐리거나 지표가 화면에 없으면 절대 추정하지 말고 null을 반환하라.
RSI, Stochastic %K/%D, MACD와 Signal, 현재가를 우선 판독하라.
지지/저항은 이미지의 가시적인 가격축과 최근 고저점을 근거로 명확할 때만 제시하라.
signal은 "매수 후보", "약한 매수 후보", "관망", "약한 매도 후보", "매도 후보" 중 하나.
confidence는 이미지 판독 신뢰도 0~100이다.
reasons에는 최대 5개의 짧은 한국어 근거를 넣는다.
JSON만 출력하라:
{"ticker":string|null,"current_price":string|null,"rsi":number|null,"stoch_k":number|null,"stoch_d":number|null,"macd":number|null,"macd_signal":number|null,"trend":string|null,"support":string|null,"resistance":string|null,"invalidation":string|null,"signal":string,"confidence":number,"reasons":string[]}`;

  const response=await openai.responses.create({
   model: process.env.OPENAI_MODEL || "gpt-5.6",
   input:[{role:"user",content:[
    {type:"input_text",text:prompt},
    {type:"input_image",image_url:data,detail:"high"}
   ]}]
  });
  let txt=response.output_text.trim().replace(/^```json\s*/,"").replace(/```$/,"").trim();
  const result=JSON.parse(txt);
  res.json(result);
 }catch(err){
  console.error(err);
  res.status(500).json({error:"이미지 분석에 실패했습니다. 서버 설정과 API 키를 확인하세요."});
 }
});
const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`Stock Signal AI v2: http://localhost:${port}`));
