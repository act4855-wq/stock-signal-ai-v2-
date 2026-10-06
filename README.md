# Stock Signal AI v2

휴대폰 차트 스크린샷을 서버로 보내 이미지에서 RSI / Stochastic / MACD 등을 판독하는 프로토타입입니다.

## 실행
1. Node.js 18+ 설치
2. 이 폴더에서 `npm install`
3. 환경변수 `OPENAI_API_KEY` 설정
4. 필요하면 `OPENAI_MODEL`에 이미지 입력을 지원하는 현재 사용 가능 모델명을 설정
5. `npm start`
6. 브라우저에서 `http://localhost:3000`

## 구조
- `public/index.html`: 아이폰/모바일 UI
- `server.js`: 이미지 업로드 + OpenAI Responses API 연결
- API 키는 브라우저 코드에 넣지 않습니다.

## 주의
이미지에 표시되지 않거나 흐린 숫자는 추정하지 않도록 프롬프트를 구성했습니다.
이 프로그램의 기술적 신호는 투자수익을 보장하지 않습니다.
