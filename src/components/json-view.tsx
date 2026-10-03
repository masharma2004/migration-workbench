export function JsonView({ value, maxChars = 4000 }: { value: unknown; maxChars?: number }) {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
      {text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters)` : text}
    </pre>
  );
}
