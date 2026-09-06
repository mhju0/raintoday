import Link from "next/link";

export default function NotFound() {
  return (
    <main className="btd">
      <header className="btd-mast">
        <p className="local-eyebrow">오늘비 · 404</p>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p className="btd-lede">주소를 확인하거나 예보 화면에서 지역을 다시 골라 주세요.</p>
      </header>
      <footer className="btd-foot">
        <Link href="/">예보로 돌아가기</Link>
      </footer>
    </main>
  );
}
