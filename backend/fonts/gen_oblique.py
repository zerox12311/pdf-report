# 產生內建字型的假斜體（oblique）變體：CJK 字型沒有真斜體檔，
# 比照 Word 的做法對字形做 12° 斜切，供引擎的 [i] 行內標記使用。
#
# 用法（fonttools 4.x）：
#   python3 -m venv /tmp/ftvenv && /tmp/ftvenv/bin/pip install fonttools
#   /tmp/ftvenv/bin/python gen_oblique.py
#
# 產出（同目錄）：
#   NotoSansTC-Italic.ttf / NotoSansTC-BoldItalic.ttf
#   NotoSerifTC-Italic.ttf / NotoSerifTC-BoldItalic.ttf
#   NotoSansMono-Italic.ttf / NotoSansMono-BoldItalic.ttf
#
# 斜切不改變 advance width：斜體與正體同寬，引擎量測寬度可共用。
import math

from fontTools.misc.transform import Transform
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SLANT_DEG = 12.0
SHEAR = Transform(1, 0, math.tan(math.radians(SLANT_DEG)), 1, 0, 0)

PAIRS = [
    ("NotoSansTC-Regular.ttf", "NotoSansTC-Italic.ttf"),
    ("NotoSansTC-Bold.ttf", "NotoSansTC-BoldItalic.ttf"),
    ("NotoSerifTC-Regular.ttf", "NotoSerifTC-Italic.ttf"),
    ("NotoSerifTC-Bold.ttf", "NotoSerifTC-BoldItalic.ttf"),
    ("NotoSansMono-Regular.ttf", "NotoSansMono-Italic.ttf"),
    ("NotoSansMono-Bold.ttf", "NotoSansMono-BoldItalic.ttf"),
]


def obliquify(src: str, dst: str) -> None:
    font = TTFont(src)
    glyph_set = font.getGlyphSet()
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    new_glyphs = {}
    for name in font.getGlyphOrder():
        # 先展開複合字形再斜切，避免組件參照到已斜切的基底字形被斜兩次
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(pen, SHEAR))
        new_glyphs[name] = pen.glyph()
    for name, glyph in new_glyphs.items():
        glyf[name] = glyph
        aw, lsb = hmtx[name]
        if glyph.numberOfContours > 0:
            lsb = min(x for x, _ in glyph.coordinates)
        hmtx[name] = (aw, lsb)

    font["post"].italicAngle = -SLANT_DEG
    font["head"].macStyle |= 0b10
    os2 = font["OS/2"]
    os2.fsSelection = (os2.fsSelection | 0x01) & ~0x40  # italic on、regular off
    name_table = font["name"]
    for nid, sep in ((1, " "), (3, "-"), (4, " "), (6, "-")):
        for rec in name_table.names:
            if rec.nameID == nid:
                rec.string = (rec.toUnicode() + sep + "Italic").encode(
                    "utf_16_be" if rec.isUnicode() else "latin1", "ignore"
                )
    font.save(dst)
    print(f"{src} -> {dst}")


if __name__ == "__main__":
    for src, dst in PAIRS:
        obliquify(src, dst)
