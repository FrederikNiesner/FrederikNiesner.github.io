#!/usr/bin/env python3
"""
CV Generator — converts cv/content.md into a styled PDF.

Usage:
    python cv/generate.py          # uses year from frontmatter
    python cv/generate.py 2026     # override year
"""

import os
import re
import sys
import shutil
import datetime
import yaml
import markdown
from jinja2 import Template
from weasyprint import HTML

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)

CONTENT_PATH = os.path.join(SCRIPT_DIR, "content.md")
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "template.html")
BUILDS_DIR = os.path.join(SCRIPT_DIR, "builds")
FILES_DIR = os.path.join(ROOT_DIR, "files")


def parse_frontmatter(text):
    """Split YAML frontmatter from markdown body."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        return {}, text
    meta = yaml.safe_load(match.group(1))
    body = match.group(2)
    return meta, body


def md_to_html(md_text):
    """Convert markdown to HTML, then post-process for CV styling."""
    html = markdown.markdown(md_text, extensions=["extra"])

    html = re.sub(
        r"(<h3>.*?</h3>\s*<p>)<em>(.*?)</em>",
        r'\1<span class="entry-meta">\2</span>',
        html,
    )

    html = re.sub(
        r'(</span></p>\s*<p>)(?!<|<span)([^<]+?)(</p>)',
        r'\1<span class="entry-subtitle">\2</span>\3',
        html,
    )

    return html


def generate():
    with open(CONTENT_PATH, "r", encoding="utf-8") as f:
        raw = f.read()

    meta, body = parse_frontmatter(raw)

    year = sys.argv[1] if len(sys.argv) > 1 else str(meta.get("year", datetime.date.today().year))
    filename = f"FN_CV_{year}"

    content_html = md_to_html(body)

    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = Template(f.read())

    name_parts = meta.get("name", "").rsplit(" ", 1)
    meta["first_name"] = name_parts[0] if len(name_parts) > 1 else meta.get("name", "")
    meta["last_name"] = name_parts[1] if len(name_parts) > 1 else ""

    rendered = template.render(
        content=content_html,
        **meta,
    )

    os.makedirs(BUILDS_DIR, exist_ok=True)
    os.makedirs(FILES_DIR, exist_ok=True)

    html_path = os.path.join(BUILDS_DIR, f"{filename}.html")
    pdf_build_path = os.path.join(BUILDS_DIR, f"{filename}.pdf")
    pdf_live_path = os.path.join(FILES_DIR, f"{filename}.pdf")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(rendered)

    HTML(string=rendered, base_url=SCRIPT_DIR).write_pdf(pdf_build_path)

    shutil.copy2(pdf_build_path, pdf_live_path)

    print(f"Generated:  {html_path}")
    print(f"Generated:  {pdf_build_path}")
    print(f"Copied to:  {pdf_live_path}")
    print(f"\nDone. '{filename}.pdf' is ready.")


if __name__ == "__main__":
    generate()
