import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Iniciar sesión" };
export default function LoginPage() {
  return <AuthForm mode="login" />;
}
