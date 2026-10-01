# 오픈뱅킹 서비스

오픈뱅킹으로 여러 은행 잔액을 한 화면에 모으고, 잔액 조회만으로는 보이지 않던 상품·수수료·혜택을 나란히 비교합니다. 한 기관이 늦으면 그 기관만 따로 두고, 먼저 도착한 계좌부터 보여 줍니다.

잔액 숫자는 금융결제원 오픈뱅킹 테스트베드가 줍니다. 금리와 혜택은 오픈뱅킹 응답에 없으므로, 상품명에 맞춰 이 앱이 붙이는 참고 정보입니다.

## 쓰는 API

테스트베드만 호출합니다. `https://testapi.openbanking.or.kr`

| 단계 | 메서드 | 경로 |
| --- | --- | --- |
| 사용자인증 | GET | `/oauth/2.0/authorize` |
| 토큰발급 | POST | `/oauth/2.0/token` |
| 사용자정보조회 | GET | `/v2.0/user/me` |
| 잔액조회 | GET | `/v2.0/account/balance/fin_num` |

잔액조회는 계좌마다 따로 호출합니다. 제한 시간(8초)을 넘긴 기관은 지연으로 표시하고, 나머지 결과는 그대로 화면에 남습니다.

## 개발자사이트에서 할 일

[금융결제원 오픈API 개발자사이트](https://developers.kftc.or.kr)에서 아래를 끝낸 뒤 키를 넣습니다.

1. 회원가입
2. 앱 등록 후 Client ID / Client Secret 발급  
   마이페이지 → API Key 관리
3. Callback URL 등록  
   `http://localhost:3000/callback`  
   등록 후 이용중인 서비스에서 Callback URL 등록까지 완료
4. 테스트용 응답 데이터 등록  
   사용자정보조회의 계좌 목록, 잔액조회의 가상 잔액·상품명
5. 사이트 안 REST API 테스트 도구로 토큰 발급 → 사용자정보조회 → 잔액조회가 되는지 확인

## 실행

`.env.example`을 `.env`로 복사한 뒤 실행합니다.

```bash
npm install
npm start
```

`.env`에 발급받은 값을 넣습니다.

```
CLIENT_ID=
CLIENT_SECRET=
CLIENT_USE_CODE=
CALLBACK_URL=http://localhost:3000/callback
```

`CLIENT_USE_CODE`는 마이페이지 내 정보의 이용기관코드 10자리입니다. 잔액조회의 은행거래고유번호(`이용기관코드 + U + 9자리`)에 씁니다.

브라우저에서 http://localhost:3000 을 엽니다.

- **오픈뱅킹 테스트베드 연결**: 키가 있을 때. 인증 화면에서 돌아오면 토큰을 발급하고 사용자정보와 잔액을 조회합니다.
- **테스트 데이터로 보기**: 키가 없어도 됩니다. `data/test-responses.json`은 개발자사이트에 등록하는 테스트 응답과 같은 형식이고, 느린저축은행만 늦게 도착하게 해 두었습니다.

토큰은 서버 세션에만 있고 화면에 나오지 않습니다.
