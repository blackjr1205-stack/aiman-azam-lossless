
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const MANIFEST = {
  id: "com.aimanazam.lossless",
  name: "Aiman Azam Lossless",
  version: "1.1.0",
  resources: ["search", "stream"],
  allowDownloads: 0,
  settings: [
    {
      key: "quality",
      type: "select",
      default: "lossless",
      options: [
        { label: "Lossless FLAC", value: "lossless" }
      ]
    }
  ]
};

const IA = "https://archive.org";
const ALLOWED_LICENSES = [
  "creativecommons.org/publicdomain/zero/1.0",
  "creativecommons.org/publicdomain/mark/1.0",
  "creativecommons.org/licenses/by/4.0",
  "creativecommons.org/licenses/by-sa/4.0"
];

async function getJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("Internet Archive unavailable");
  }

  return response.json();
}

function licensed(metadata) {
  const license = String(
    metadata?.licenseurl || ""
  ).toLowerCase();

  return ALLOWED_LICENSES.some(
    item => license.includes(item)
  );
}

function findFLAC(files) {
  return (files || [])
    .filter(file =>
      file.name?.toLowerCase().endsWith(".flac")
    )
    .sort(
      (a, b) =>
        Number(b.size || 0) - Number(a.size || 0)
    )[0] || null;
}

function mediaURL(id, filename) {
  return `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;
}

async function resolveTrack(id) {
  const data = await getJSON(
    `${IA}/metadata/${encodeURIComponent(id)}`
  );

  if (!licensed(data.metadata)) return null;

  const file = findFLAC(data.files);
  if (!file) return null;

  const creator = data.metadata.creator;

  return {
    id,
    title: data.metadata.title || id,
    artist: Array.isArray(creator)
      ? creator.join(", ")
      : creator || "Unknown Artist",
    album: data.metadata.album || "",
    duration: Number(file.length) || undefined,
    artworkURL: `${IA}/services/img/${encodeURIComponent(id)}`,
    format: "flac",
    audioQuality: "LOSSLESS",
    streamURL: mediaURL(id, file.name),
    licenseURL: data.metadata.licenseurl
  };
}

// Manifest
app.get("/manifest.json", (req, res) => {
  res.json(MANIFEST);
});

app.get("/", (req, res) => {
  res.json(MANIFEST);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    name: MANIFEST.name,
    version: MANIFEST.version
  });
});

// Search
app.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.json({ tracks: [] });
  }

  try {
    const params = new URLSearchParams();

    params.set(
      "q",
      `mediatype:audio AND (${query})`
    );

    ["identifier", "title", "creator", "album"]
      .forEach(field => params.append("fl[]", field));

    params.set("rows", "20");
    params.set("output", "json");

    const result = await getJSON(
      `${IA}/advancedsearch.php?${params}`
    );

    const docs = result.response?.docs || [];

    const results = await Promise.all(
      docs.slice(0, 20).map(async doc => {
        try {
          return await resolveTrack(doc.identifier);
        } catch {
          return null;
        }
      })
    );

    res.json({
      tracks: results.filter(Boolean)
    });

  } catch (error) {
    console.error(error);
    res.status(502).json({
      tracks: [],
      error: "Search temporarily unavailable"
    });
  }
});

// FLAC streaming resolver
app.get("/stream/:id", async (req, res) => {
  try {
    const track = await resolveTrack(req.params.id);

    if (!track) {
      return res.status(404).json({
        error: "No eligible FLAC found"
      });
    }

    res.json({
      url: track.streamURL,
      format: "flac",
      codec: "flac",
      container: "flac",
      manifest: "none",
      encrypted: false
    });

  } catch (error) {
    console.error(error);
    res.status(502).json({
      error: "Unable to resolve FLAC"
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Aiman Azam Lossless running on port ${PORT}`
  );
});

