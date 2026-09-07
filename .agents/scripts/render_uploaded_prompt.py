from pathlib import Path

import fitz


pdf_path = Path("attached_assets/Latest_Prompt_for_SafeNet_DNS_via_Replit_1788742316521.pdf")
output_dir = Path(".agents/outputs/latest-prompt-pages")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(pdf_path)
print(f"pages={document.page_count}")
for page_number, page in enumerate(document, start=1):
    output_path = output_dir / f"page-{page_number}.png"
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pixmap.save(output_path)
    print(f"rendered={output_path} size={page.rect.width}x{page.rect.height}")