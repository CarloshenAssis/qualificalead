import { AuthForm } from '@/components/auth/AuthForm';
import { signUp } from '@/app/auth/actions';

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <AuthForm mode="signup" action={signUp} />
    </main>
  );
}
