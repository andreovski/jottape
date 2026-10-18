/** Erro esperado de regra de negócio: vira a resposta com o status e a mensagem dados. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new AppError(404, `${what} não encontrado.`);
