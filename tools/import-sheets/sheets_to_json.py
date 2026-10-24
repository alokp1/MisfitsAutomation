"""Convert the old "Daily Hotel Performance Sheet" workbook into JSON for the server's
history import (qr-menu/server/src/scripts/import-history.js).

Standard library only. The output contains guest names, so write it outside the repo:

    python sheets_to_json.py "Daily Hotel Performance Sheet 2026-27.xlsx" shoja > ../../../shoja-history.json

Room and bed checks happen in the server loader, which knows the real room list.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

ROOMS_SHEET = "Daily Rooms Revenue Summary"
EXPENSES_SHEET = "Daily Expences"

PAYMENT_MODES = {"upi": "upi", "cash": "cash", "prepaid": "prepaid", "card": "card"}
OTAS = {"mmt": "MMT", "goibibo": "GoIbibo", "agoda": "Agoda", "booking.com": "Booking.com",
        "hostelworld": "Hostelworld", "airbnb": "Airbnb"}
EXPENSE_CATEGORIES = [
    (r"veg|sabzi", "Vegetables"),
    (r"egg|milk|curd|paneer|dairy", "Dairy & eggs"),
    (r"wifi|internet|electric|water bill", "Utilities & internet"),
    (r"gas|diesel|petrol|fuel", "Gas & fuel"),
    (r"repair|maint", "Maintenance & repairs"),
    (r"laundry|clean|detergent", "Cleaning & laundry"),
    (r"salary|wage", "Salaries & wages"),
    (r"maggi|bread|bun|rice|atta|grocer|water", "Groceries"),
]


def read_workbook(path):
    z = zipfile.ZipFile(path)
    bad = z.testzip()
    if bad:
        sys.exit(f"{path}: corrupt member {bad}")
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter(M + "t"))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find(M + "sheets"):
        target = "xl/" + rels[s.get(R + "id")].lstrip("/").removeprefix("xl/")
        rows = {}
        for row in ET.fromstring(z.read(target)).iter(M + "row"):
            cells = {}
            for c in row.findall(M + "c"):
                v = c.find(M + "v")
                if c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(M + "t"))
                elif v is None:
                    continue
                elif c.get("t") == "s":
                    val = shared[int(v.text)]
                else:
                    val = v.text
                cells[re.match(r"[A-Z]+", c.get("r")).group()] = val
            rows[int(row.get("r"))] = cells
        sheets[s.get("name")] = rows
    return sheets


def find_sheet(sheets, prefix):
    for name, rows in sheets.items():
        if name.lower().startswith(prefix.lower()):
            return rows
    sys.exit(f"No sheet starting with {prefix!r}; found {list(sheets)}")


def as_date(v):
    """Excel serial number → 'YYYY-MM-DD', else None."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not 30000 < n < 80000:
        return None
    return (date(1899, 12, 30) + timedelta(days=int(n))).isoformat()


def as_number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def clean(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def units_from(raw):
    """'106-1,106-2' → beds; '102 All' / '206' / '206.0' → whole room."""
    units = []
    for m in re.finditer(r"(\d{3})(?:\.0)?(?:\s*-\s*(\d+))?", raw):
        units.append({"code": m.group(1), "bed": int(m.group(2)) if m.group(2) else None})
    return units


def bookings_from(rows):
    out, skipped = [], []
    for n in sorted(rows):
        if n == 1:
            continue
        r = rows[n]
        guest = clean(r.get("C"))
        if not guest:
            continue
        problems = []
        check_in = as_date(r.get("B")) or as_date(r.get("A"))
        check_out = as_date(r.get("J"))
        if not check_in:
            skipped.append({"sheet_row": n, "guest_name": guest, "reason": "no check-in date"})
            continue
        if not check_out or check_out <= check_in:
            problems.append(f"check-out in the sheet was {check_out or 'blank'}; set to the next day")
            check_out = (date.fromisoformat(check_in) + timedelta(days=1)).isoformat()

        pay_raw = clean(r.get("G")).lower()
        payment = PAYMENT_MODES.get(pay_raw)
        if not payment:
            payment = "pending"
            problems.append(f"payment '{clean(r.get('G'))}' not recognised")

        src_raw = clean(r.get("H"))
        if src_raw.lower() == "website":
            source, ota = "website", ""
        elif src_raw.lower() in OTAS:
            source, ota = "ota", OTAS[src_raw.lower()]
        else:
            source, ota = "other", ""
            problems.append(f"source '{src_raw}' not recognised")

        amount = as_number(r.get("I"))
        if amount is None or amount < 0:
            problems.append("amount missing")
            amount = 0

        units = units_from(clean(r.get("F")))
        if not units:
            problems.append(f"room '{clean(r.get('F'))}' not recognised")

        people = as_number(r.get("E"))
        out.append({
            "sheet_row": n,
            "guest_name": guest,
            "check_in": check_in,
            "check_out": check_out,
            "people": int(people) if people and people > 0 else max(1, len(units)),
            "source": source,
            "ota": ota,
            "amount_paise": round(amount * 100),
            "payment_mode": payment,
            "units": units,
            "room_text": clean(r.get("F")),
            "problems": problems,
        })
    return out, skipped


def expenses_from(rows):
    out = []
    for n in sorted(rows):
        r = rows[n]
        spent_on = as_date(r.get("A"))
        total = as_number(r.get("F"))
        item = clean(r.get("B"))
        if not spent_on or not total or total <= 0 or not item:
            continue
        # The sheet's quantity and unit columns are swapped relative to their headers.
        qty, unit = clean(r.get("C")), clean(r.get("D"))
        qty = qty[:-2] if qty.endswith(".0") else qty
        description = item + (f" · {qty} {unit}".rstrip() if qty else "")
        category = next((c for pattern, c in EXPENSE_CATEGORIES if re.search(pattern, item, re.I)), "Other")
        method = clean(r.get("H")).lower()
        out.append({
            "sheet_row": n,
            "spent_on": spent_on,
            "category": category,
            "description": description,
            "amount_paise": round(total * 100),
            "paid_by": clean(r.get("G")),
            "payment_mode": "upi" if method in ("online", "upi") else "card" if method == "card" else "cash",
        })
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    path, location = sys.argv[1], sys.argv[2]
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    sheets = read_workbook(path)
    bookings, skipped = bookings_from(find_sheet(sheets, ROOMS_SHEET))
    data = {
        "location_id": location,
        "source_file": path.replace("\\", "/").rsplit("/", 1)[-1],
        "bookings": bookings,
        "skipped_rows": skipped,
        "expenses": expenses_from(find_sheet(sheets, EXPENSES_SHEET)),
    }
    json.dump(data, sys.stdout, ensure_ascii=False, indent=1)
    flagged = sum(1 for b in data["bookings"] if b["problems"])
    print(f"{len(bookings)} bookings ({flagged} with problems noted), {len(skipped)} rows skipped, "
          f"{len(data['expenses'])} expenses",
          file=sys.stderr)


if __name__ == "__main__":
    main()
