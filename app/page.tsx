import { redirect } from 'next/navigation';

export default function Home() {
  // O middleware ja decide entre /login e /dashboard conforme a sessao.
  redirect('/dashboard');
}
