// Script for document management and dashboard visualization

// Base URL for backend API. Using 127.0.0.1 instead of localhost avoids
// certain security restrictions on some systems.
const API_BASE_URL = "http://127.0.0.1:5000/api";

// Pagination state for documents table
let allDocuments = [];
let currentPage = 1;
let itemsPerPage = 5;

// State for sorting documents table. Stores last sorted column index and direction.
let docSortState = { column: -1, ascending: true };

// Global Chart.js styling to give a polished dashboard look similar to Tableau/Power BI
Chart.defaults.font.family = 'Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif';
Chart.defaults.color = '#343a40';
Chart.defaults.plugins.legend.position = 'bottom';

let productChart = null;
let categoryChart = null;

/**
 * Fetch AI insights (suggestions and projections) and display them in the dashboard.
 */
async function loadAiInsights() {
  try {
    const response = await fetch(`${API_BASE_URL}/analytics/ai`);
    const data = await response.json();
    const suggDiv = document.getElementById("aiSuggestions");
    const projDiv = document.getElementById("aiProjections");
    if (!data || !data.suggestions) {
      suggDiv.textContent = "No hay sugerencias disponibles.";
      projDiv.textContent = "";
      return;
    }
    // Display suggestions as paragraphs
    suggDiv.innerHTML = data.suggestions
      .map((s) => `<p class="mb-1">${s}</p>`)
      .join("");
    // Build projections table
    const entries = Object.entries(data.projections || {});
    if (entries.length === 0) {
      projDiv.textContent = "No hay proyecciones disponibles.";
    } else {
      // Sort by projected total descending and take top 5
      entries.sort((a, b) => b[1].proyeccion_total - a[1].proyeccion_total);
      const topEntries = entries.slice(0, 5);
      let html = '<div class="table-responsive"><table class="table table-sm table-bordered"><thead><tr><th>Producto</th><th>Cant. actual</th><th>Proy. total</th></tr></thead><tbody>';
      topEntries.forEach(([name, stats]) => {
        html += `<tr><td>${name}</td><td>${stats.cantidad_actual.toFixed(0)}</td><td>${stats.proyeccion_total.toFixed(0)}</td></tr>`;
      });
      html += '</tbody></table></div>';
      projDiv.innerHTML = html;
    }
  } catch (err) {
    console.error("Error al obtener sugerencias de AI:", err);
  }
}

/**
 * Render the current page of documents based on pagination state.
 */
function renderDocumentsPage() {
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const docsToShow = allDocuments.slice(start, end);
  renderDocumentTable(docsToShow);
  updatePaginationControls();
}

/**
 * Update pagination controls (info text, disabled state) based on current state.
 */
function updatePaginationControls() {
  const totalPages = Math.ceil(allDocuments.length / itemsPerPage) || 1;
  // Update info text
  const infoSpan = document.getElementById("paginationInfo");
  infoSpan.textContent = `${currentPage} / ${totalPages}`;
  // Disable prev/next buttons when at bounds
  document.getElementById("prevPageBtn").disabled = currentPage <= 1;
  document.getElementById("nextPageBtn").disabled = currentPage >= totalPages;
  // Set select value to reflect current itemsPerPage
  const select = document.getElementById("itemsPerPageSelect");
  if (select.value !== String(itemsPerPage)) {
    select.value = String(itemsPerPage);
  }
}

/**
 * Toggle visibility of dashboard charts and metrics based on user selection.
 */
function toggleDashboards() {
  const showDocType = document.getElementById("toggleDocType").checked;
  const showSize = document.getElementById("toggleSize").checked;
  const showAvg = document.getElementById("toggleAvgPages").checked;
  const showProvider = document.getElementById("toggleProvider").checked;
  const showProductSummary = document.getElementById("toggleProductSummary").checked;
  const showProductMonthly = document.getElementById("toggleProductMonthly").checked;
  document.getElementById("docTypeChartContainer").style.display = showDocType ? "block" : "none";
  document.getElementById("fileSizeChartContainer").style.display = showSize ? "block" : "none";
  // The avg pages container has hidden attribute that we also handle in loadDashboard
  if (!showAvg) {
    document.getElementById("avgPagesContainer").style.display = "none";
  } else {
    // We will restore display when loadDashboard sets hidden false
    document.getElementById("avgPagesContainer").style.display = "block";
  }
  // Provider chart
  document.getElementById("providerChartContainer").style.display = showProvider ? "block" : "none";
  // Product summary
  document.getElementById("productSummaryChartContainer").style.display = showProductSummary ? "block" : "none";
  // Product monthly container
  document.getElementById("productMonthlyContainer").style.display = showProductMonthly ? "block" : "none";
}

/**
 * Export selected documents to CSV by calling backend API and triggering download.
 */
async function exportSelectedToCsv() {
  const checkboxes = document.querySelectorAll(".select-checkbox:checked");
  const ids = Array.from(checkboxes).map((cb) => parseInt(cb.value));
  try {
    // Build query string based on global filters only when no ids (exporting all filtered)
    const supplier = document.getElementById("supplierSelect").value;
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    const params = new URLSearchParams();
    if (!ids.length) {
      // Only attach filters when exporting full list (ids empty)
      if (supplier) params.append("supplier", supplier);
      if (start) params.append("start", start);
      if (end) params.append("end", end);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${API_BASE_URL}/documents/csv${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const csvText = await response.text();
    if (!response.ok) {
      throw new Error("Error al generar el archivo CSV");
    }
    // Create blob and download
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "documentos.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Load existing documents
  loadDocuments();
  // Load suppliers for filter
  loadSuppliers();
  // Load initial product and category charts
  loadProductChart();
  loadCategoryChart();
  // Set up upload form handler
  const uploadForm = document.getElementById("upload-form");
  uploadForm.addEventListener("submit", handleUpload);
  // CSV export button for documents
  document.getElementById("exportCsvBtn").addEventListener("click", exportSelectedToCsv);
  // Pagination controls
  document.getElementById("itemsPerPageSelect").addEventListener("change", (e) => {
    itemsPerPage = parseInt(e.target.value, 10) || 5;
    currentPage = 1;
    renderDocumentsPage();
  });
  document.getElementById("prevPageBtn").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderDocumentsPage();
    }
  });
  document.getElementById("nextPageBtn").addEventListener("click", () => {
    const totalPages = Math.ceil(allDocuments.length / itemsPerPage) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      renderDocumentsPage();
    }
  });
  // Delete all documents button
  document.getElementById("deleteAllBtn").addEventListener("click", async () => {
    if (!confirm("¿Estás seguro de eliminar todos los documentos? Esta acción no se puede deshacer.")) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/documents/delete_all`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Error al eliminar documentos");
      }
      await loadDocuments();
      await loadSuppliers();
      // Reload charts after deletion
      await loadProductChart();
      await loadCategoryChart();
    } catch (err) {
      alert(err.message);
    }
  });
  // Export products summary to Excel
  document.getElementById("exportProductsBtn").addEventListener("click", async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/products/export`);
      if (!response.ok) {
        throw new Error("Error al exportar datos de productos");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "productos.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  });
  // Export categories summary to Excel
  document.getElementById("exportCategoriesBtn").addEventListener("click", async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/categories/export`);
      if (!response.ok) {
        throw new Error("Error al exportar categorías");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "categorias.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  });
  // Apply filter button. When clicked, reload all data (documents, product chart, category chart)
  document.getElementById("applyFiltersBtn").addEventListener("click", () => {
    // Reset page to first when applying filters
    currentPage = 1;
    loadDocuments();
    loadProductChart();
    loadCategoryChart();
  });
  // Chart type selector
  document.getElementById("productChartType").addEventListener("change", () => {
    loadProductChart();
  });

  // Metric selector for product summary
  document.getElementById("productMetricSelect").addEventListener("change", () => {
    loadProductChart();
  });

  // Add click listeners to table headers for sorting
  const headerCells = document.querySelectorAll("#docs-table thead th");
  headerCells.forEach((th, idx) => {
    // Skip first column (selection) and last column (actions)
    if (idx === 0 || th.textContent.trim().toLowerCase().startsWith('acciones')) return;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      // Toggle sorting direction if same column clicked; otherwise default to ascending
      if (docSortState.column === idx) {
        docSortState.ascending = !docSortState.ascending;
      } else {
        docSortState.column = idx;
        docSortState.ascending = true;
      }
      sortDocumentsByColumn(idx, docSortState.ascending);
      currentPage = 1;
      renderDocumentsPage();
    });
  });
});

/**
 * Fetch the list of documents from the backend and display them.
 */
async function loadDocuments() {
  try {
    // Build query based on global filters
    const supplier = document.getElementById("supplierSelect").value;
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    const invoice = document.getElementById("invoiceInput").value.trim();
    const params = new URLSearchParams();
    if (supplier) params.append("supplier", supplier);
    if (start) params.append("start", start);
    if (end) params.append("end", end);
    if (invoice) params.append("invoice", invoice);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${API_BASE_URL}/documents${query}`);
    const data = await response.json();
    allDocuments = data.documents || [];
    // Reset pagination to first page when reloading data
    currentPage = 1;
    renderDocumentsPage();
  } catch (err) {
    console.error("Error al obtener documentos:", err);
  }
}

/**
 * Render a table with the provided document metadata.
 * @param {Array} docs
 */
function renderDocumentTable(docs) {
  const tbody = document.getElementById("docs-body");
  tbody.innerHTML = "";
  docs.forEach((doc) => {
    const row = document.createElement("tr");
    // Checkbox cell for selection
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("select-checkbox");
    checkbox.value = doc.id;
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);
    // Provider name (or fallback to filename)
    const nameCell = document.createElement("td");
    nameCell.textContent = doc.supplier_name || doc.filename || "-";
    row.appendChild(nameCell);
    // Type
    const typeCell = document.createElement("td");
    typeCell.textContent = doc.filetype.toUpperCase();
    row.appendChild(typeCell);
    // Size in KB
    const sizeCell = document.createElement("td");
    sizeCell.textContent = (doc.size_bytes / 1024).toFixed(1);
    row.appendChild(sizeCell);
    // Pages or XML root
    const metaCell = document.createElement("td");
    if (doc.filetype === "pdf") {
      metaCell.textContent = doc.pages !== null ? `${doc.pages} pág.` : "-";
    } else if (doc.filetype === "xml") {
      metaCell.textContent = doc.xml_root || "-";
    } else {
      metaCell.textContent = "-";
    }
    row.appendChild(metaCell);
    // Supplier RUT
    const rutCell = document.createElement("td");
    rutCell.textContent = doc.supplier_rut || "-";
    row.appendChild(rutCell);
    // Invoice number
    const invoiceCell = document.createElement("td");
    invoiceCell.textContent = doc.invoice_number || "-";
    row.appendChild(invoiceCell);
    // Invoice total formatted in CLP pesos
    const totalCell = document.createElement("td");
    const totalVal = doc.invoice_total != null ? parseFloat(doc.invoice_total) : 0;
    totalCell.textContent = totalVal ? '$' + totalVal.toLocaleString('es-CL') : "-";
    row.appendChild(totalCell);
    // Document date (fecha de la factura)
    const dateCell = document.createElement("td");
    if (doc.doc_date) {
      const dateObj = new Date(doc.doc_date);
      dateCell.textContent = dateObj.toLocaleDateString();
    } else {
      dateCell.textContent = "-";
    }
    row.appendChild(dateCell);
    // Actions
    const actionsCell = document.createElement("td");
    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Descargar";
    // Use Bootstrap button styling for a cleaner look
    downloadBtn.classList.add("btn", "btn-primary", "btn-sm");
    downloadBtn.addEventListener("click", () => downloadDocument(doc.id, doc.filename));
    actionsCell.appendChild(downloadBtn);
    row.appendChild(actionsCell);
    tbody.appendChild(row);
  });
}

/**
 * Handle uploading of a document from the form.
 * @param {Event} event
 */
async function handleUpload(event) {
  event.preventDefault();
  const fileInput = document.getElementById("file-input");
  const files = Array.from(fileInput.files);
  if (!files || files.length === 0) {
    alert("Por favor seleccione uno o más archivos.");
    return;
  }
  // Show progress bar
  const progressContainer = document.getElementById("uploadProgressContainer");
  const progressBar = document.getElementById("uploadProgressBar");
  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  progressBar.textContent = "0%";
  const totalFiles = files.length;
  let uploaded = 0;
  for (const file of files) {
    const formData = new FormData();
    // Use 'files' field to match backend logic
    formData.append('files', file);
    try {
      const response = await fetch(`${API_BASE_URL}/documents`, {
        method: 'POST',
        body: formData,
      });
      // Attempt to parse JSON to detect errors
      let result;
      try { result = await response.json(); } catch (_) { result = {}; }
      if (!response.ok) {
        throw new Error(result.error || 'Error al subir los archivos.');
      }
    } catch (err) {
      alert(err.message);
      // Hide progress bar and stop further uploads
      progressContainer.style.display = 'none';
      return;
    }
    uploaded++;
    const percent = Math.round((uploaded / totalFiles) * 100);
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${percent}%`;
  }
  // Hide progress bar after completion
  progressContainer.style.display = 'none';
  // Reset file input
  fileInput.value = '';
  // Reload documents and update charts after upload
  await loadDocuments();
  await loadSuppliers();
  await loadProductChart();
  await loadCategoryChart();
}

/**
 * Download a document by creating a hidden link and triggering click.
 * @param {number} id
 * @param {string} filename
 */
function downloadDocument(id, filename) {
  const link = document.createElement("a");
  link.href = `${API_BASE_URL}/documents/${id}/download`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Fetch dashboard statistics and render charts accordingly.
 */
async function loadDashboard() {
  try {
    const response = await fetch(`${API_BASE_URL}/dashboard`);
    const stats = await response.json();
    // Render chart of document types
    renderDocTypeChart(stats.count_per_type);
    // Render chart of file sizes distribution
    renderFileSizeChart(stats.file_sizes);
    // Display average pages if available
    const avgPagesContainer = document.getElementById("avgPagesContainer");
    const avgPagesText = document.getElementById("avgPagesText");
    if (stats.avg_pages !== null && stats.avg_pages !== undefined) {
      avgPagesContainer.hidden = false;
      avgPagesText.textContent = `Promedio de páginas (PDF): ${stats.avg_pages.toFixed(1)}`;
    } else {
      avgPagesContainer.hidden = true;
    }
  } catch (err) {
    console.error("Error al obtener datos de dashboard:", err);
  }
  // Update dashboard visibility according to toggles
  toggleDashboards();
}

/**
 * Fetch analytics data (suppliers, products, monthly) without product filter.
 */
async function loadAnalytics() {
  try {
    const response = await fetch(`${API_BASE_URL}/analytics`);
    analyticsData = await response.json();
    // Render provider usage chart
    renderProviderChart(analyticsData.providers_usage);
    // Render product summary chart (use top products by total quantity)
    renderProductSummaryChart(analyticsData.products_summary);
    // Populate product select
    await loadProductsList();
  } catch (err) {
    console.error("Error al obtener analytics:", err);
  }
}

/**
 * Fetch list of products and populate the product selector.
 */
async function loadProductsList() {
  try {
    const response = await fetch(`${API_BASE_URL}/products`);
    const data = await response.json();
    const select = document.getElementById("productSelect");
    select.innerHTML = "";
    // Add placeholder option
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "-- Selecciona --";
    select.appendChild(placeholder);
    data.products.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error al cargar lista de productos:", err);
  }
}

/**
 * Fetch product-specific analytics and render monthly chart.
 * @param {string} productName
 */
async function loadProductAnalytics(productName) {
  if (!productName) {
    // Clear chart if no product selected
    if (productMonthlyChart) productMonthlyChart.destroy();
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/analytics?product=${encodeURIComponent(productName)}`);
    const data = await response.json();
    if (data.product_monthly) {
      renderProductMonthlyChart(productName, data.product_monthly);
    }
  } catch (err) {
    console.error("Error al obtener analytics del producto:", err);
  }
}

/**
 * Load list of suppliers from backend and populate the supplier select element.
 * Adds an initial option for all suppliers.
 */
async function loadSuppliers() {
  try {
    const response = await fetch(`${API_BASE_URL}/suppliers`);
    const data = await response.json();
    const select = document.getElementById("supplierSelect");
    select.innerHTML = "";
    // Option for all suppliers
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todos";
    select.appendChild(optAll);
    (data.suppliers || []).forEach((s) => {
      const option = document.createElement("option");
      option.value = s.id;
      option.textContent = `${s.name}`;
      select.appendChild(option);
    });
  } catch (err) {
    console.error("Error al cargar proveedores:", err);
  }
}

/**
 * Load product chart data with filters and render the chart.
 * The filters are read from the supplier select and start/end month inputs.
 */
async function loadProductChart() {
  try {
    // Get filters
    const supplier = document.getElementById("supplierSelect").value;
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    // Build query string
    const params = new URLSearchParams();
    if (supplier) params.append("supplier", supplier);
    if (start) params.append("start", start);
    if (end) params.append("end", end);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${API_BASE_URL}/analytics/products/chart${query}`);
    const data = await response.json();
    const summary = data.products || {};
    // Prepare labels and values
    const metric = document.getElementById("productMetricSelect").value || "qty";
    const entries = Object.entries(summary);
    // Sort by selected metric descending and take top 15
    entries.sort((a, b) => {
      const aval = metric === "value" ? (a[1].total_value || 0) : (a[1].total_qty || 0);
      const bval = metric === "value" ? (b[1].total_value || 0) : (b[1].total_qty || 0);
      return bval - aval;
    });
    const topEntries = entries.slice(0, 15);
    const labels = topEntries.map((e) => e[0]);
    const values = topEntries.map((e) => metric === "value" ? (e[1].total_value || 0) : (e[1].total_qty || 0));
    const ctx = document.getElementById("productChart").getContext("2d");
    const chartType = document.getElementById("productChartType").value;
    if (productChart) productChart.destroy();
    productChart = new Chart(ctx, {
      type: chartType,
      data: {
        labels,
        datasets: [
          {
            label: metric === "value" ? "Valor total" : "Cantidad total",
            data: values,
            backgroundColor: chartType === "pie" ? labels.map(() => getRandomColor()) : (metric === "value" ? "rgba(40, 167, 69, 0.6)" : "rgba(0, 123, 255, 0.6)"),
            borderColor: chartType === "pie" ? [] : (metric === "value" ? "rgba(40, 167, 69, 1)" : "rgba(0, 123, 255, 1)"),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: metric === "value" ? "Productos con mayor valor comprado" : "Productos más comprados",
          },
          legend: {
            position: chartType === "pie" ? "right" : "bottom",
          },
        },
        scales: chartType === "bar" ? {
          y: {
            beginAtZero: true,
            title: { display: true, text: metric === "value" ? "Valor total (CLP)" : "Cantidad" },
          },
          x: {
            title: { display: true, text: "Productos" },
          },
        } : {},
      },
    });
  } catch (err) {
    console.error("Error al cargar gráfico de productos:", err);
  }
}

/**
 * Load category analytics and render category chart.
 */
async function loadCategoryChart() {
  try {
    // Apply same filters as product chart
    const supplier = document.getElementById("supplierSelect").value;
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    const params = new URLSearchParams();
    if (supplier) params.append("supplier", supplier);
    if (start) params.append("start", start);
    if (end) params.append("end", end);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${API_BASE_URL}/analytics/categories${query}`);
    const data = await response.json();
    const categories = data.categories || {};
    const labels = Object.keys(categories);
    // Use total purchase value as metric on Y axis
    const qtyValues = labels.map((cat) => categories[cat].total_value);
    const ctx = document.getElementById("categoryChart").getContext("2d");
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Valor total (CLP)",
            data: qtyValues,
            backgroundColor: labels.map(() => getRandomColor()),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Valor total (CLP)" },
          },
          x: {
            title: { display: true, text: "Categorías" },
          },
        },
        plugins: {
          title: {
            display: true,
            text: "Costo comprado por categoría",
          },
          legend: {
            display: false,
          },
        },
      },
    });
  } catch (err) {
    console.error("Error al cargar gráfico de categorías:", err);
  }
}

/**
 * Generate a random color for charts.
 * @returns {string}
 */
function getRandomColor() {
  const r = Math.floor(Math.random() * 255);
  const g = Math.floor(Math.random() * 255);
  const b = Math.floor(Math.random() * 255);
  return `rgba(${r}, ${g}, ${b}, 0.6)`;
}

/**
 * Sort the global allDocuments array by a column index.
 * The index corresponds to visible columns:
 * 0: Seleccionar (ignored), 1: Proveedor, 2: Tipo, 3: Tamaño, 4: Páginas/Etiqueta, 5: RUT,
 * 6: Factura N°, 7: Monto total, 8: Fecha, 9: Acciones (ignored).
 * Sorting will gracefully handle missing values.
 *
 * @param {number} idx - The column index to sort by.
 * @param {boolean} asc - Whether to sort ascending (true) or descending (false).
 */
function sortDocumentsByColumn(idx, asc) {
  const getKey = (doc) => {
    switch (idx) {
      case 1: // Proveedor
        return (doc.supplier_name || doc.filename || '').toLowerCase();
      case 2: // Tipo
        return (doc.filetype || '').toLowerCase();
      case 3: // Tamaño
        return doc.size_bytes || 0;
      case 4: // Páginas / Etiqueta raíz
        if (doc.filetype === 'pdf') {
          return doc.pages != null ? doc.pages : -1;
        }
        return (doc.xml_root || '').toLowerCase();
      case 5: // RUT
        return (doc.supplier_rut || '').toLowerCase();
      case 6: // Factura N°
        return (doc.invoice_number || '').toLowerCase();
      case 7: // Monto total
        return doc.invoice_total != null ? parseFloat(doc.invoice_total) : 0;
      case 8: // Fecha
        return doc.doc_date || '';
      default:
        return '';
    }
  };
  allDocuments.sort((a, b) => {
    const aKey = getKey(a);
    const bKey = getKey(b);
    // Handle numbers and strings differently
    if (typeof aKey === 'number' && typeof bKey === 'number') {
      return asc ? aKey - bKey : bKey - aKey;
    }
    // Convert dates if ISO strings
    if (idx === 8) {
      const aDate = aKey ? new Date(aKey) : new Date(0);
      const bDate = bKey ? new Date(bKey) : new Date(0);
      return asc ? aDate - bDate : bDate - aDate;
    }
    // Compare as strings
    if (aKey < bKey) return asc ? -1 : 1;
    if (aKey > bKey) return asc ? 1 : -1;
    return 0;
  });
}

/**
 * Render a bar chart showing number of documents per supplier.
 * @param {Object} usage
 */
function renderProviderChart(usage) {
  const ctx = document.getElementById("providerChart").getContext("2d");
  const labels = Object.keys(usage);
  const data = Object.values(usage);
  if (providerChart) providerChart.destroy();
  providerChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Número de documentos",
          data,
          backgroundColor: "rgba(0, 123, 255, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Cantidad" } },
        x: { title: { display: true, text: "Proveedores" } },
      },
      plugins: { title: { display: true, text: "Documentos por proveedor" } },
    },
  });
}

/**
 * Render a bar chart showing top products by total quantity.
 * @param {Object} productsSummary
 */
function renderProductSummaryChart(productsSummary) {
  const ctx = document.getElementById("productSummaryChart").getContext("2d");
  // Sort products by total quantity descending and take top 10
  const entries = Object.entries(productsSummary);
  entries.sort((a, b) => b[1].total_qty - a[1].total_qty);
  const topEntries = entries.slice(0, 10);
  const labels = topEntries.map((e) => e[0]);
  const data = topEntries.map((e) => e[1].total_qty);
  if (productSummaryChart) productSummaryChart.destroy();
  productSummaryChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Cantidad total",
          data,
          backgroundColor: "rgba(255, 193, 7, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Cantidad" } },
        x: { title: { display: true, text: "Productos" } },
      },
      plugins: { title: { display: true, text: "Top productos por cantidad" } },
    },
  });
}

/**
 * Render a line chart showing monthly quantity and prices for a product.
 * @param {string} productName
 * @param {Object} monthlyData
 */
function renderProductMonthlyChart(productName, monthlyData) {
  const ctx = document.getElementById("productMonthlyChart").getContext("2d");
  const months = Object.keys(monthlyData).sort();
  const qtyValues = months.map((m) => monthlyData[m].total_qty || 0);
  const avgPrices = months.map((m) => monthlyData[m].avg_price || 0);
  // Two datasets: quantity and average price on secondary axis
  if (productMonthlyChart) productMonthlyChart.destroy();
  productMonthlyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Cantidad",
          data: qtyValues,
          backgroundColor: "rgba(40, 167, 69, 0.6)",
          yAxisID: 'y',
        },
        {
          label: "Precio promedio",
          data: avgPrices,
          type: 'line',
          borderColor: "rgba(220, 53, 69, 0.8)",
          backgroundColor: "rgba(220, 53, 69, 0.3)",
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Cantidad' },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          title: { display: true, text: 'Precio' },
          grid: { drawOnChartArea: false },
        },
        x: { title: { display: true, text: 'Mes' } },
      },
      plugins: {
        title: { display: true, text: `Detalle mensual para ${productName}` },
      },
    },
  });
}

/**
 * Render a pie chart showing the number of documents per type.
 * @param {Object} countPerType
 */
function renderDocTypeChart(countPerType) {
  const ctx = document.getElementById("docTypeChart").getContext("2d");
  const labels = Object.keys(countPerType);
  const data = Object.values(countPerType);
  const chartTypeSelect = document.getElementById("docTypeChartType");
  const selectedType = chartTypeSelect.value || "pie";
  if (docTypeChart) {
    docTypeChart.destroy();
  }
  docTypeChart = new Chart(ctx, {
    type: selectedType,
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: ["#007bff", "#28a745", "#ffc107", "#dc3545"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Cantidad de documentos por tipo",
        },
      },
      scales: selectedType === "bar" ? {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Número de documentos" },
        },
        x: {
          title: { display: true, text: "Tipos" },
        },
      } : {},
    },
  });
}

/**
 * Render a bar chart or histogram representing file sizes in KB.
 * @param {Array<number>} fileSizes Array of file sizes in bytes
 */
function renderFileSizeChart(fileSizes) {
  const ctx = document.getElementById("fileSizeChart").getContext("2d");
  // Convert sizes to KB and round
  const sizesKB = fileSizes.map((size) => size / 1024);
  // Determine bins for histogram (0-100KB, 100-500KB, 500-1000KB, >1000KB)
  const bins = {
    "0-100 KB": 0,
    "100-500 KB": 0,
    "500-1000 KB": 0,
    ">1000 KB": 0,
  };
  sizesKB.forEach((size) => {
    if (size <= 100) bins["0-100 KB"]++;
    else if (size <= 500) bins["100-500 KB"]++;
    else if (size <= 1000) bins["500-1000 KB"]++;
    else bins[">1000 KB"]++;
  });
  const labels = Object.keys(bins);
  const data = Object.values(bins);
  if (fileSizeChart) {
    fileSizeChart.destroy();
  }
  fileSizeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Número de documentos",
          data,
          backgroundColor: "rgba(40, 167, 69, 0.6)",
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Cantidad",
          },
        },
        x: {
          title: {
            display: true,
            text: "Rangos de tamaño (KB)",
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Distribución de tamaños de archivos",
        },
      },
    },
  });
}