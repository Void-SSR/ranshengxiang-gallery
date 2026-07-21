#!/usr/bin/env python3
"""从 catalog.json 和无损 PNG 原图生成两份离线客户展示 PDF。"""

from __future__ import annotations

import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parents[1]
CATALOG_PATH = ROOT / "catalog.json"
ORIGINALS_DIR = ROOT / "assets" / "originals"
OUTPUT_DIR = PROJECT_ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
CACHE_DIR = TMP_DIR / "image-cache"

MOBILE_OUTPUT = OUTPUT_DIR / "苒盛香-包装方案-手机版离线高清.pdf"
DESKTOP_OUTPUT = OUTPUT_DIR / "苒盛香-包装方案-电脑版离线对比.pdf"

FONT_FILE = "/System/Library/Fonts/Supplemental/Songti.ttc"
FONT = "EmbeddedSongti"
FONT_BOLD = "EmbeddedSongtiBold"
INK = HexColor("#341810")
MUTED = HexColor("#795F53")
PAPER = HexColor("#F4EADC")
PAPER_DEEP = HexColor("#E7D2B6")
RED = HexColor("#8B281A")
ORANGE = HexColor("#D85B27")
GOLD = HexColor("#BD8C47")
WHITE = HexColor("#FFF8EE")
LINE = Color(52 / 255, 24 / 255, 16 / 255, alpha=0.16)


@dataclass(frozen=True)
class Entry:
    id: str
    category: str
    original_path: Path
    cached_path: Path


def load_entries() -> list[Entry]:
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entries: list[Entry] = []
    for row in raw:
        original = ORIGINALS_DIR / row["originalFilename"]
        if not original.is_file():
            raise FileNotFoundError(f"缺少原图: {original}")
        cached = CACHE_DIR / f"{row['id']}.jpg"
        entries.append(Entry(str(row["id"]), str(row["category"]), original, cached))
    if len(entries) != 80:
        raise RuntimeError(f"预期 80 张图，实际 {len(entries)} 张")
    return entries


def prepare_images(entries: list[Entry]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for index, entry in enumerate(entries, start=1):
        with Image.open(entry.original_path) as source:
            image = ImageOps.exif_transpose(source)
            if image.mode in ("RGBA", "LA"):
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, (244, 234, 220))
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            image.save(
                entry.cached_path,
                "JPEG",
                quality=96,
                subsampling=0,
                optimize=True,
                progressive=True,
            )
        print(f"[原图处理 {index:02d}/{len(entries)}] {entry.category}类 {entry.id}号", flush=True)


def grouped(entries: list[Entry]) -> list[tuple[str, list[Entry]]]:
    return [(category, [entry for entry in entries if entry.category == category]) for category in ("A", "B", "C")]


def draw_header(
    pdf: canvas.Canvas,
    page_width: float,
    page_height: float,
    category: str,
    category_page: int,
    category_pages: int,
    page_number: int,
    total_pages: int,
    margin: float,
) -> float:
    header_height = 15 * mm
    top = page_height - margin
    pdf.setFillColor(RED)
    pdf.rect(margin, top - header_height, page_width - 2 * margin, header_height, stroke=0, fill=1)
    pdf.setFillColor(WHITE)
    pdf.setFont(FONT_BOLD, 12)
    pdf.drawString(margin + 5 * mm, top - 9.5 * mm, "苒盛香 · 祖传牛舌饼包装策略")
    pdf.setFont(FONT, 9)
    pdf.drawRightString(
        page_width - margin - 5 * mm,
        top - 9.3 * mm,
        f"{category}类方案  {category_page}/{category_pages}",
    )
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT, 7.5)
    pdf.drawRightString(page_width - margin, 5.2 * mm, f"第 {page_number}/{total_pages} 页")
    return top - header_height - 4 * mm


def draw_entry(
    pdf: canvas.Canvas,
    entry: Entry,
    x: float,
    y: float,
    width: float,
    height: float,
    label_height: float,
) -> None:
    pdf.setFillColor(PAPER_DEEP)
    pdf.roundRect(x, y, width, height, 1.5 * mm, stroke=0, fill=1)

    label_y = y + height - label_height
    pdf.setFillColor(WHITE)
    pdf.rect(x, label_y, width, label_height, stroke=0, fill=1)
    pdf.setFillColor(ORANGE)
    pdf.rect(x, label_y, 1.8 * mm, label_height, stroke=0, fill=1)
    pdf.setFillColor(INK)
    pdf.setFont(FONT_BOLD, 10)
    pdf.drawString(x + 5 * mm, label_y + 2.5 * mm, f"{entry.category}类  {entry.id}号")

    image_x = x + 2.5 * mm
    image_y = y + 2.5 * mm
    image_width = width - 5 * mm
    image_height = height - label_height - 5 * mm
    with Image.open(entry.cached_path) as image:
        source_width, source_height = image.size
    scale = min(image_width / source_width, image_height / source_height)
    draw_width = source_width * scale
    draw_height = source_height * scale
    draw_x = image_x + (image_width - draw_width) / 2
    draw_y = image_y + (image_height - draw_height) / 2
    pdf.drawImage(
        ImageReader(str(entry.cached_path)),
        draw_x,
        draw_y,
        draw_width,
        draw_height,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.45)
    pdf.roundRect(x, y, width, height, 1.5 * mm, stroke=1, fill=0)


def page_plan(entries: list[Entry], per_page: int) -> list[tuple[str, int, int, list[Entry]]]:
    pages: list[tuple[str, int, int, list[Entry]]] = []
    for category, category_entries in grouped(entries):
        category_pages = math.ceil(len(category_entries) / per_page)
        for index in range(category_pages):
            pages.append(
                (
                    category,
                    index + 1,
                    category_pages,
                    category_entries[index * per_page : (index + 1) * per_page],
                )
            )
    return pages


def create_mobile(entries: list[Entry]) -> None:
    page_width, page_height = A4
    margin = 9 * mm
    gap = 5 * mm
    pages = page_plan(entries, per_page=2)
    pdf = canvas.Canvas(str(MOBILE_OUTPUT), pagesize=A4, pageCompression=1)
    pdf.setTitle("苒盛香 - 包装方案 - 手机版离线高清")
    pdf.setAuthor("苒盛香")
    pdf.setSubject("80张牛舌饼包装方案，A/B/C类，单列高清浏览")

    content_bottom = 10 * mm
    for page_number, (category, category_page, category_pages, page_entries) in enumerate(pages, start=1):
        if category_page == 1:
            key = f"mobile-{category}"
            pdf.bookmarkPage(key)
            pdf.addOutlineEntry(f"{category}类方案", key, level=0, closed=False)
        content_top = draw_header(
            pdf, page_width, page_height, category, category_page, category_pages,
            page_number, len(pages), margin,
        )
        cell_width = page_width - 2 * margin
        cell_height = (content_top - content_bottom - gap) / 2
        for slot, entry in enumerate(page_entries):
            y = content_top - (slot + 1) * cell_height - slot * gap
            draw_entry(pdf, entry, margin, y, cell_width, cell_height, 9 * mm)
        pdf.showPage()
        print(f"[手机版 {page_number:02d}/{len(pages)}] {category}类", flush=True)
    pdf.save()


def create_desktop(entries: list[Entry]) -> None:
    page_size = landscape(A3)
    page_width, page_height = page_size
    margin = 9 * mm
    gap_x = 4.5 * mm
    gap_y = 4.5 * mm
    pages = page_plan(entries, per_page=6)
    pdf = canvas.Canvas(str(DESKTOP_OUTPUT), pagesize=page_size, pageCompression=1)
    pdf.setTitle("苒盛香 - 包装方案 - 电脑版离线对比")
    pdf.setAuthor("苒盛香")
    pdf.setSubject("80张牛舌饼包装方案，A/B/C类，每页六图对比")

    content_bottom = 10 * mm
    for page_number, (category, category_page, category_pages, page_entries) in enumerate(pages, start=1):
        if category_page == 1:
            key = f"desktop-{category}"
            pdf.bookmarkPage(key)
            pdf.addOutlineEntry(f"{category}类方案", key, level=0, closed=False)
        content_top = draw_header(
            pdf, page_width, page_height, category, category_page, category_pages,
            page_number, len(pages), margin,
        )
        cell_width = (page_width - 2 * margin - 2 * gap_x) / 3
        cell_height = (content_top - content_bottom - gap_y) / 2
        for slot, entry in enumerate(page_entries):
            row, column = divmod(slot, 3)
            x = margin + column * (cell_width + gap_x)
            y = content_top - (row + 1) * cell_height - row * gap_y
            draw_entry(pdf, entry, x, y, cell_width, cell_height, 8 * mm)
        pdf.showPage()
        print(f"[电脑版 {page_number:02d}/{len(pages)}] {category}类", flush=True)
    pdf.save()


def main() -> None:
    pdfmetrics.registerFont(TTFont(FONT, FONT_FILE, subfontIndex=6))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, FONT_FILE, subfontIndex=1))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    entries = load_entries()
    prepare_images(entries)
    create_mobile(entries)
    create_desktop(entries)
    shutil.rmtree(CACHE_DIR, ignore_errors=True)
    print(f"已生成: {MOBILE_OUTPUT}", flush=True)
    print(f"已生成: {DESKTOP_OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
