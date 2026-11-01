# 체험 부스 예약 (miso-reservation)

행사장 체험 부스용 한 페이지 예약 사이트. 기존 체험 사이트(healthzone.misoinfo.co.kr)의
글씨체(Pretendard)·색상 변수·여백·버튼 스타일을 그대로 가져왔다.

## 규칙
- 예약 단위 10분, **한국 시간 기준 지금부터 2시간 이내**의 시간만 선택 가능
- 예약 가능 시간 09:00 ~ 18:00 (18:00 전에 시작하는 슬롯까지)
- 이름 + 휴대폰 번호 수집, 목적은 체험 부스 예약. 예약 시간이 지나고 보관 시간(기본 120분)이 지나면 자동 삭제
- 중복 검사는 휴대폰 번호로만: 같은 번호는 한 건만 예약 가능 (자동 삭제 전까지). 예약된 시간은 마감 처리되어 다른 사람이 고를 수 없음

## 관리자 (`#admin`)
- 비밀번호: 환경변수 `ADMIN_KEY` (기본 `miso1234`)
- 시간 설정: 예약 시작/종료, 예약 단위(분), 예약 가능 범위(분), 체험 후 보관(분), 부스 이름
- 예약 목록: 30초마다 자동 새로고침, 개별 삭제 / 전체 삭제, 전화번호 탭하면 전화 걸기

## 실행
```bash
./start.sh                # 127.0.0.1:5500 , 로그 logs/server.log , pid logs/server.pid
PORT=5501 ADMIN_KEY=비밀번호 ./start.sh
kill $(cat logs/server.pid)   # 중지
```
의존성 없음 (Node 18+). 데이터는 `data/db.json` 에 저장.

## 접속
- Dev Room 포탈: https://dev.daonlabs.kr/r/5500/  (관리자: https://dev.daonlabs.kr/r/5500/#admin)
- 경로 앞 `/r/5500` 접두사는 서버가 떼어내고 처리하며, 링크·API 는 모두 상대 경로라 어떤 base path 에서도 동작한다.

## 구조
```
server.js          # HTTP 서버 + API (/api/slots, /api/reserve, /api/admin/*)
public/index.html  # 예약 / 완료 / 관리자 화면 (한 페이지)
public/style.css   # healthzone 스타일 이식
public/app.js      # 화면 전환·폼·관리자 로직
```
