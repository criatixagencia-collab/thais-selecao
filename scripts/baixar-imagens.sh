#!/bin/bash
# Download images para selecao interativa com delay para evitar rate limit
DEST="/Users/rafaeloliver/.openclaw/workspace-thais/thais-selecao/selecao-20260623-1030/imagens"
mkdir -p "$DEST"

download() {
  local url="$1"
  local name="$2"
  local ext="${url##*.}"
  ext="${ext%%\?*}"
  local file="$DEST/$name.$ext"
  
  echo "Baixando $name..."
  curl -sL --retry 2 --retry-delay 5 "$url" -o "$file"
  sleep 3
  if [ -f "$file" ] && [ -s "$file" ]; then
    file_type=$(file "$file" | grep -iE "image|jpeg|png|gif|bitmap" | head -c 100)
    if [ -n "$file_type" ]; then
      echo "  OK: $file_type"
    else
      echo "  AVISO: pode nao ser imagem"
    fi
  else
    echo "  FALHA: arquivo vazio ou nao criado"
  fi
}

# Zé Felipe
download "https://upload.wikimedia.org/wikipedia/commons/9/9e/Z%C3%A9_Felipe_na_CPI_das_BETS.jpg" "ze-felipe"

# Virginia
download "https://upload.wikimedia.org/wikipedia/commons/3/3c/Virginia_Fonseca_na_CPI_das_BETS.jpg" "virginia"

# Ana Castela
download "https://upload.wikimedia.org/wikipedia/commons/d/dc/Ana_Castela_at_Lady_Night_in_2024_2.jpg" "ana-castela"

# Bruna Marquezine
download "https://upload.wikimedia.org/wikipedia/commons/2/2b/Marquezine_by_Arezzo_01.jpg" "bruna-marquezine"

# Anitta 1
download "https://upload.wikimedia.org/wikipedia/commons/2/23/Anitta_for_Attractive_Mindset_podcast_02.jpg" "anitta-podcast"

# Anitta 2
download "https://upload.wikimedia.org/wikipedia/commons/1/1c/Anitta_2021.jpg" "anitta-2021"

# Thelma
download "https://upload.wikimedia.org/wikipedia/commons/0/0e/Telma_Assis_2021.jpg" "thelma"

# Zé e Ana juntos
download "https://upload.wikimedia.org/wikipedia/commons/1/1e/Ana_Castela_e_Z%C3%A9_Felipe_no_anivers%C3%A1rio_de_Marrone.jpg" "ze-e-ana"

echo ""
echo "Downloads concluidos em $DEST"
ls -la "$DEST/"
