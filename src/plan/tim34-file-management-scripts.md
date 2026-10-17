# Tim 34 File Management Scripts

This document recaps the Terminal scripts used to manage the daily Excel output files inside the `Tim 34` folder on macOS.

Assumed working directory:

```text
Tim 34/
├── 2026-10-17/
├── 63 - KALIMANTAN SELATAN/
├── 64 - KALIMANTAN TIMUR/
└── 65 - KALIMANTAN UTARA/
```

Run the commands below from inside the `Tim 34` folder unless stated otherwise.

---

## 1. Create a date subfolder inside every kabupaten/kota folder

Example for `2026-10-17`.

If already inside one province folder, for example `63 - KALIMANTAN SELATAN`:

```bash
for dir in 63*/; do
    mkdir -p "$dir/2026-10-17"
done
```

If running from `Tim 34` and you want to create the date folder under all kabupaten/kota folders across provinces 63, 64, and 65:

### Dry run

```bash
for dir in 6*/*/; do
    echo "$dir/2026-10-17"
done
```

### Create folders

```bash
for dir in 6*/*/; do
    mkdir -p "$dir/2026-10-17"
done
```

---

## 2. Distribute Excel files by kabupaten/kota code

This script scans all `.xlsx` files under a daily source folder such as:

```text
2026-10-17/
```

It reads the 4-digit kabupaten/kota code from filenames such as:

```text
Kategori_A_Hortikultura_6301_1btv73m.xlsx
Kategori_F_6571_1pf912l.xlsx
```

and maps them automatically to folders such as:

```text
63 - KALIMANTAN SELATAN/6301 - TANAH LAUT/2026-10-17/
65 - KALIMANTAN UTARA/6571 - KOTA TARAKAN/2026-10-17/
```

### Dry run

```bash
DATE="2026-10-17"

find "$DATE" -type f -name "*.xlsx" | while IFS= read -r file; do
    name="$(basename "$file")"

    code="$(printf '%s\n' "$name" | sed -nE 's/.*_([0-9]{4})_.*/\1/p')"

    if [[ -n "$code" ]]; then
        prov="$(printf '%s' "$code" | cut -c1-2)"

        provdir="$(find . -maxdepth 1 -type d -name "$prov - *" -print -quit)"

        if [[ -n "$provdir" ]]; then
            dest="$(find "$provdir" -maxdepth 1 -type d -name "$code - *" -print -quit)"
        else
            dest=""
        fi

        if [[ -n "$dest" ]]; then
            echo "$file"
            echo "  -> $dest/$DATE/"
        else
            echo "NOT FOUND: $name [$code]"
        fi
    else
        echo "NO CODE: $name"
    fi
done
```

---

## 3. Safer move version that avoids silent overwrite

Plain `mv` can overwrite files that have identical names.

A safer option is to auto-number duplicates.

Example:

```text
RantabDBNAS_6571_1pf912l.xlsx
RantabDBNAS_6571_1pf912l_2.xlsx
RantabDBNAS_6571_1pf912l_3.xlsx
```

Use this pattern inside the move logic:

```bash
target="$dest/$DATE/$name"

if [[ -e "$target" ]]; then
    base="${name%.xlsx}"
    i=2

    while [[ -e "$dest/$DATE/${base}_$i.xlsx" ]]; do
        ((i++))
    done

    target="$dest/$DATE/${base}_$i.xlsx"
fi

mv "$file" "$target"
```

---

## 4. Full safe distribution script with duplicate protection

```bash
DATE="2026-10-17"

find "$DATE" -type f -name "*.xlsx" | while IFS= read -r file; do
    name="$(basename "$file")"

    code="$(printf '%s\n' "$name" | sed -nE 's/.*_([0-9]{4})_.*/\1/p')"

    if [[ -z "$code" ]]; then
        echo "NO CODE: $name"
        continue
    fi

    prov="$(printf '%s' "$code" | cut -c1-2)"

    provdir="$(find . -maxdepth 1 -type d -name "$prov - *" -print -quit)"

    if [[ -z "$provdir" ]]; then
        echo "PROVINCE NOT FOUND: $name [$code]"
        continue
    fi

    dest="$(find "$provdir" -maxdepth 1 -type d -name "$code - *" -print -quit)"

    if [[ -z "$dest" ]]; then
        echo "KAB/KOTA NOT FOUND: $name [$code]"
        continue
    fi

    mkdir -p "$dest/$DATE"

    target="$dest/$DATE/$name"

    if [[ -e "$target" ]]; then
        base="${name%.xlsx}"
        i=2

        while [[ -e "$dest/$DATE/${base}_$i.xlsx" ]]; do
            ((i++))
        done

        target="$dest/$DATE/${base}_$i.xlsx"
    fi

    echo "$file"
    echo "  -> $target"

    mv "$file" "$target"
done
```

---

## 5. Special naming plan for RantabDBNAS output files

The intended descriptive filenames are:

```text
RantabDBNAS_6571_1pf912l_query_jumlah_remark.xlsx
RantabDBNAS_6571_1pf912l_rantab_DBNAS_jumlah_per_flag.xlsx
RantabDBNAS_6571_1pf912l_rantab_DBNAS_semua_kategori.xlsx
```

These correspond to SQL jobs:

```text
query_jumlah_remark.sql
rantab_DBNAS_jumlah_per_flag.sql
rantab_DBNAS_semua_kategori.sql
```

The proposed logic was:

```bash
DATE="2026-10-17"

find "$DATE" -type f -name "*.xlsx" | while IFS= read -r file; do
    name="$(basename "$file")"
    parent="$(basename "$(dirname "$file")")"

    code="$(printf '%s\n' "$name" | sed -nE 's/.*_([0-9]{4})_.*/\1/p')"

    if [[ -z "$code" ]]; then
        echo "NO CODE: $name"
        continue
    fi

    prov="$(printf '%s' "$code" | cut -c1-2)"

    provdir="$(find . -maxdepth 1 -type d -name "$prov - *" -print -quit)"

    if [[ -z "$provdir" ]]; then
        echo "PROVINCE NOT FOUND: $name [$code]"
        continue
    fi

    dest="$(find "$provdir" -maxdepth 1 -type d -name "$code - *" -print -quit)"

    if [[ -z "$dest" ]]; then
        echo "KAB/KOTA NOT FOUND: $name [$code]"
        continue
    fi

    mkdir -p "$dest/$DATE"

    random_id="$(printf '%s\n' "$name" | sed -nE 's/.*_[0-9]{4}_([^.]*)\.xlsx/\1/p')"

    if [[ "$name" == RantabDBNAS_* ]]; then

        if [[ "$parent" == *"query_jumlah_remark"* ]]; then
            newname="RantabDBNAS_${code}_${random_id}_query_jumlah_remark.xlsx"

        elif [[ "$parent" == *"rantab_DBNAS_jumlah_per_flag"* ]]; then
            newname="RantabDBNAS_${code}_${random_id}_rantab_DBNAS_jumlah_per_flag.xlsx"

        elif [[ "$parent" == *"rantab_DBNAS_semua_kategori"* ]]; then
            newname="RantabDBNAS_${code}_${random_id}_rantab_DBNAS_semua_kategori.xlsx"

        else
            newname="$name"
        fi

    else
        newname="$name"
    fi

    target="$dest/$DATE/$newname"

    if [[ -e "$target" ]]; then
        base="${newname%.xlsx}"
        i=2

        while [[ -e "$dest/$DATE/${base}_$i.xlsx" ]]; do
            ((i++))
        done

        target="$dest/$DATE/${base}_$i.xlsx"
    fi

    echo "$file"
    echo "  -> $target"

    mv "$file" "$target"
done
```

Important limitation:

If the source folders are only generic UUID-based folders such as:

```text
RantabDBNAS_run-61ac2023-6b0d-4ea7-acc2-93eee8e0a843_part-001
RantabDBNAS_run-b3a7a687-0a1f-458a-80c5-87345c53b0fa_part-001
RantabDBNAS_run-b3b7b6b8-cfbb-4e24-b26c-a662837a4899_part-001
```

the script cannot know which run corresponds to which SQL query unless a mapping is defined separately.

---

## 6. Find mistaken `_partial` files

### Dry run

```bash
find . -type f -name "*_partial*"
```

For Excel files only:

```bash
find . -type f -name "*_partial*.xlsx"
```

---

## 7. Move `_partial` Excel files to macOS Trash

```bash
find . -type f -name "*_partial*.xlsx" -exec mv -n {} ~/.Trash/ \;
```

Note:

`mv -n` does not overwrite files already in Trash. If duplicate filenames exist, later duplicates stay in place.

---

## 8. Find all RantabDBNAS files

### Dry run

```bash
find . -type f -name "RantabDBNAS_*"
```

Excel only:

```bash
find . -type f -name "RantabDBNAS_*.xlsx"
```

---

## 9. Move all RantabDBNAS Excel files to macOS Trash

```bash
find . -type f -name "RantabDBNAS_*.xlsx" -exec mv -n {} ~/.Trash/ \;
```

Again, `mv -n` prevents overwrite inside Trash.

---

## 10. Daily usage

For another day, only change:

```bash
DATE="2026-10-18"
```

or:

```bash
DATE="2026-10-19"
```

The distribution scripts will then target that day's source and destination folders.

---

## Recommended workflow

1. Run a dry-run first.
2. Check that each source file maps to the expected province and kabupaten/kota.
3. Use duplicate-safe move logic.
4. Verify output folders.
5. Only then clean mistaken `_partial` or `RantabDBNAS_` files.
6. Avoid plain `mv` when identical filenames may exist.

