import { AuthForm } from '@/components/auth/AuthForm';
import { signIn } from '@/app/auth/actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <AuthForm mode="signin" action={signIn} next={next} />
    </main>
  );
}
