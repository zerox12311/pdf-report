// 資料路徑寫入工具（編輯器產生範例資料用）。
// 讀取端的對應實作在 Go 後端 renderspec.go 的 ResolveRaw/ResolvePath。

/** 把 "a.b" / "items[0].name" 路徑的值寫進物件（產生範例資料用）。 */
export function setPath(target: any, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;
  for (let s = 0; s < segments.length; s++) {
    const last = s === segments.length - 1;
    let name = segments[s];
    const indices: number[] = [];
    const bracket = name.indexOf('[');
    if (bracket >= 0) {
      for (const part of name.slice(bracket).replace(/^\[|\]$/g, '').split('][')) {
        const i = parseInt(part, 10);
        if (!isNaN(i)) indices.push(i);
      }
      name = name.slice(0, bracket);
    }
    const keys: (string | number)[] = [...(name ? [name] : []), ...indices];
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const isLastKey = last && k === keys.length - 1;
      if (isLastKey) {
        current[key] = value;
      } else {
        const nextKey = k + 1 < keys.length ? keys[k + 1] : (segments[s + 1].indexOf('[') === 0 ? 0 : segments[s + 1]);
        if (current[key] == null) current[key] = typeof nextKey === 'number' ? [] : {};
        current = current[key];
      }
    }
  }
}
