function wrapTextByWords(content: string, max: number, prefix = ""): string[] {
  const words = content.split(/(\s+)/).filter(Boolean);
  const result: string[] = [];
  let current = prefix;

  for (const word of words) {
    const candidate = `${current}${word}`;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }

    if (current.trim()) {
      result.push(current.trimEnd());
      current = prefix;
    }

    const bareWord = word.trim();
    if (bareWord && `${prefix}${bareWord}`.length > max) {
      let remaining = bareWord;
      const available = Math.max(1, max - prefix.length);
      while (remaining.length > available) {
        result.push(`${prefix}${remaining.slice(0, available)}`);
        remaining = remaining.slice(available);
      }
      current = remaining ? `${prefix}${remaining}` : prefix;
      continue;
    }

    current = `${prefix}${word.trimStart()}`;
  }

  if (current.trim()) {
    result.push(current.trimEnd());
  }

  return result;
}

export function wrapForNaverMobile(text: string): string {
  const MAX = 26;
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (trimmed === "" || /^-{3,}$/.test(trimmed)) {
      result.push(line);
      continue;
    }

    if (
      trimmed.startsWith("#") ||
      /^https?:\/\/\S+$/i.test(trimmed) ||
      /^\[[^\]]+\]\([^)]+\)$/.test(trimmed)
    ) {
      result.push(line);
      continue;
    }

    const listMatch = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/);
    if (listMatch) {
      const [, marker, content] = listMatch;
      if (`${marker}${content}`.length <= MAX) {
        result.push(line);
        continue;
      }
      result.push(...wrapTextByWords(content, MAX, marker));
      continue;
    }

    if (line.length <= MAX) {
      result.push(line);
      continue;
    }

    result.push(...wrapTextByWords(line, MAX));
  }

  return result.join("\n");
}
