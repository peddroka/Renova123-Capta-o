export function materializeOutreachTemplate(content: string, source: string) {
  return content
    .replace(/\{\{nome\}\}/g, "")
    .replace(/\{\{empresa\}\}/g, "Renova 123")
    .replace(/\{\{produto\}\}/g, "Renova 123")
    .replace(/\{\{agente\}\}/g, "Francisco")
    .replace(/\{\{origem\}\}/g, source);
}

export function compareOutboundText(expected: string, actual: string) {
  return { equal: expected === actual, expectedLength: expected.length, actualLength: actual.length };
}
