interface Props {
  message?: string;
}

export function FormError({ message }: Props) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] text-danger">{message}</p>;
}
