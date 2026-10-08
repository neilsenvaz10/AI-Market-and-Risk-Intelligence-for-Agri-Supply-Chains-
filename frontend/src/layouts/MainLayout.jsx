import { Outlet } from 'react-router-dom';
import Header from '../components/Header';
import BottomNav from '../components/BottomNav';

export default function MainLayout() {
  return (
    <div className="bg-surface font-body-md text-on-surface flex flex-col min-h-screen w-full">
      <Header />
      <main className="flex flex-col relative w-full px-gutter pt-20 pb-36 bg-surface flex-grow">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
