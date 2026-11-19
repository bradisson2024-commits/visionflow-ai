import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Escribe tu nombre.").max(80),
  email: z.string().trim().toLowerCase().email("Correo electrónico no válido.").max(200),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo electrónico no válido."),
  password: z.string().min(1, "Escribe tu contraseña."),
});

export const projectNameSchema = z.object({
  name: z.string().trim().min(1, "El nombre no puede estar vacío.").max(120, "Máximo 120 caracteres."),
});
