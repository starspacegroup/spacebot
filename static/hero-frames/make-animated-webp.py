"""Create animated WebP from screenshot frames. 3 seconds per frame."""
from PIL import Image
import os

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.dirname(BASE)
DURATION = 3000  # ms per frame

for theme in ("dark", "light"):
    frames = []
    for i in range(1, 7):
        # Find the file matching this index
        for f in sorted(os.listdir(BASE)):
            if f.startswith(f"{theme}-{i}-") and f.endswith(".png"):
                img = Image.open(os.path.join(BASE, f))
                # Convert to RGB (WebP doesn't need alpha for photos)
                if img.mode == "RGBA":
                    # Composite on white for light, dark bg for dark
                    bg_color = (250, 250, 249) if theme == "light" else (28, 25, 23)
                    bg = Image.new("RGB", img.size, bg_color)
                    bg.paste(img, mask=img.split()[3])
                    img = bg
                elif img.mode != "RGB":
                    img = img.convert("RGB")
                frames.append(img)
                print(f"  Added {f} ({img.size[0]}x{img.size[1]})")
                break

    if not frames:
        print(f"No frames found for {theme}!")
        continue

    out_path = os.path.join(STATIC, f"server-admin-{theme}.webp")
    frames[0].save(
        out_path,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=DURATION,
        loop=0,  # infinite loop
        quality=85,
        method=4,  # encoding effort (0=fast, 6=slowest/best)
    )
    size_kb = os.path.getsize(out_path) / 1024
    print(f"Created {out_path} ({size_kb:.0f} KB, {len(frames)} frames)")

print("Done!")
