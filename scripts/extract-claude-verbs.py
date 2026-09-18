from pathlib import Path
import re, json

exe = Path.home() / ".local" / "bin" / "claude.exe"
out = Path.home() / "AppData" / "Local" / "DesktopCommander" / "claude-spinner-verbs.json"

fallback = [
    "Clauding","Combobulating","Pondering","Noodling","Tinkering",
    "Crunching","Ruminating","Canoodling","Flibbertigibbeting",
    "Manifesting","Whirring","Brewing","Cooking","Synthesizing"
]

verbs = []
try:
    b = exe.read_bytes()
    start = b.find(b"Accomplishing")
    end = b.find(b"Zigzagging", start)
    if start >= 0 and end > start:
        chunk = b[start:end+128].decode("latin1", "ignore")
        candidates = re.findall(r"[A-Za-z][A-Za-z' -]{2,32}ing", chunk)
        for x in candidates:
            x = x.strip()
            if x and x[0].isupper() and x != "setCompacting" and x not in verbs:
                verbs.append(x)
except Exception:
    pass

for x in ["Thinking","Working","Processing","Doing","Sauteing","Beboppin'","Evaporating","Flambeing"]:
    if x not in verbs:
        verbs.append(x)

if len(verbs) < 20:
    verbs = fallback

out.write_text(json.dumps(verbs, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"WROTE {len(verbs)} verbs -> {out}")
