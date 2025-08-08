// Script for document management and dashboard visualization

// Base URL for backend API. Using 127.0.0.1 instead of localhost avoids
// certain security restrictions on some systems.
const API_BASE_URL = "http://127.0.0.1:5000/api";

// Pagination state for documents list
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

// Supplier data and selection for Excel-like provider filter
let suppliersData = [];
let selectedSupplierIds = new Set();

// Document types data and selection for type filter
let docTypesData = [];
let selectedDocTypes = new Set();

// Product data for manual category assignment
let productsData = [];
// Set of product names selected for manual categorisation
let selectedCategoryProducts = new Set();

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
  renderDocumentList(docsToShow);
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
    // Build filters: supplier IDs and document types are derived from selection sets
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    const params = new URLSearchParams();
    if (!ids.length) {
      // Only attach filters when exporting full list (ids empty)
      // Supplier filter: send comma‑separated ids when not all selected
      if (selectedSupplierIds.size > 0 && selectedSupplierIds.size !== suppliersData.length) {
        params.append('supplier', Array.from(selectedSupplierIds).join(','));
      }
      // Document type filter: send comma‑separated doc types when not all selected
      if (selectedDocTypes.size > 0 && selectedDocTypes.size !== docTypesData.length) {
        params.append('type', Array.from(selectedDocTypes).join(','));
      }
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
  // Load available document types for filter
  loadDocumentTypes();
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

  // Assign category button handler
  const assignBtn = document.getElementById('assignCategoryBtn');
  if (assignBtn) {
    assignBtn.addEventListener('click', assignSelectedCategory);
  }

  // Initialize manual category assignment lists and categories
  loadProductsForAssignment();
  loadCategoriesForSelect();

  // Supplier filter dropdown toggle
  const supplierBtn = document.getElementById('supplierFilterBtn');
  const supplierMenu = document.getElementById('supplierFilterMenu');
  if (supplierBtn && supplierMenu) {
    supplierBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = supplierMenu.style.display === 'block';
      supplierMenu.style.display = visible ? 'none' : 'block';
    });
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!supplierMenu.contains(e.target) && !supplierBtn.contains(e.target)) {
        supplierMenu.style.display = 'none';
      }
    });
    // Handle select all checkbox
    const selectAllBox = document.getElementById('supplierSelectAll');
    if (selectAllBox) {
      selectAllBox.addEventListener('change', () => {
        if (selectAllBox.checked) {
          // Select all suppliers
          selectedSupplierIds = new Set(suppliersData.map((s) => s.id));
        } else {
          // Deselect all
          selectedSupplierIds = new Set();
        }
        // Update individual checkboxes
        suppliersData.forEach((s) => {
          const cb = document.getElementById(`supplier_option_${s.id}`);
          if (cb) cb.checked = selectedSupplierIds.has(s.id);
        });
        updateSupplierFilterText();
        applySupplierFilter();
      });
    }
    // Handle search filtering
    const searchInput = document.getElementById('supplierSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const term = searchInput.value.trim().toLowerCase();
        suppliersData.forEach((s) => {
          const div = document.getElementById(`supplier_option_${s.id}`)?.parentElement;
          if (div) {
            const match = s.name.toLowerCase().includes(term);
            div.style.display = match ? '' : 'none';
          }
        });
      });
    }
  }

  // Document type filter dropdown toggle
  const docTypeBtn = document.getElementById('docTypeFilterBtn');
  const docTypeMenu = document.getElementById('docTypeFilterMenu');
  if (docTypeBtn && docTypeMenu) {
    docTypeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = docTypeMenu.style.display === 'block';
      docTypeMenu.style.display = visible ? 'none' : 'block';
    });
    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!docTypeMenu.contains(e.target) && !docTypeBtn.contains(e.target)) {
        docTypeMenu.style.display = 'none';
      }
    });
    // Select all checkbox handler
    const dtSelectAll = document.getElementById('docTypeSelectAll');
    if (dtSelectAll) {
      dtSelectAll.addEventListener('change', () => {
        if (dtSelectAll.checked) {
          selectedDocTypes = new Set(docTypesData);
        } else {
          selectedDocTypes = new Set();
        }
        // Update individual checkboxes
        docTypesData.forEach((t) => {
          const safeId = t.replace(/[^a-zA-Z0-9]/g, '_');
          const cb = document.getElementById(`doctype_option_${safeId}`);
          if (cb) cb.checked = selectedDocTypes.has(t);
        });
        updateDocTypeFilterText();
        applyDocTypeFilter();
      });
    }
    // Search filter for doc types
    const dtSearchInput = document.getElementById('docTypeSearchInput');
    if (dtSearchInput) {
      dtSearchInput.addEventListener('input', () => {
        const term = dtSearchInput.value.trim().toLowerCase();
        docTypesData.forEach((t) => {
          const safeId = t.replace(/[^a-zA-Z0-9]/g, '_');
          const div = document.getElementById(`doctype_option_${safeId}`)?.parentElement;
          if (div) {
            const match = t.toLowerCase().includes(term);
            div.style.display = match ? '' : 'none';
          }
        });
      });
    }
  }

});

/**
 * Fetch the list of documents from the backend and display them.
 */
async function loadDocuments() {
  try {
    // Build query based on global filters
    const start = document.getElementById("startMonth").value;
    const end = document.getElementById("endMonth").value;
    const invoice = document.getElementById("invoiceInput").value.trim();
    const params = new URLSearchParams();
    // Supplier filter: send comma-separated ids only when not all selected
    if (selectedSupplierIds.size > 0 && selectedSupplierIds.size !== suppliersData.length) {
      params.append('supplier', Array.from(selectedSupplierIds).join(','));
    }
    // Document type filter: send comma-separated types when not all selected
    if (selectedDocTypes.size > 0 && selectedDocTypes.size !== docTypesData.length) {
      params.append('type', Array.from(selectedDocTypes).join(','));
    }
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (invoice) params.append('invoice', invoice);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE_URL}/documents${query}`);
    const data = await response.json();
    allDocuments = data.documents || [];
    // Sort documents by upload date descending for a consistent ordering
    allDocuments.sort((a, b) => {
      const adate = a.upload_date ? new Date(a.upload_date) : new Date(0);
      const bdate = b.upload_date ? new Date(b.upload_date) : new Date(0);
      return bdate - adate;
    });
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
    suppliersData = data.suppliers || [];
    // When suppliers are loaded, ensure selectedSupplierIds reflects all by default
    if (selectedSupplierIds.size === 0) {
      suppliersData.forEach((s) => selectedSupplierIds.add(s.id));
    }
    buildSupplierOptions();
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
    // Get filters from global filter controls
    const start = document.getElementById('startMonth').value;
    const end = document.getElementById('endMonth').value;
    const params = new URLSearchParams();
    // Supplier filter: send comma-separated ids when not all selected
    if (selectedSupplierIds.size > 0 && selectedSupplierIds.size !== suppliersData.length) {
      params.append('supplier', Array.from(selectedSupplierIds).join(','));
    }
    // Document type filter
    if (selectedDocTypes.size > 0 && selectedDocTypes.size !== docTypesData.length) {
      params.append('type', Array.from(selectedDocTypes).join(','));
    }
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    const query = params.toString() ? `?${params.toString()}` : '';
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
    // Apply global filters: supplier IDs, document types, start and end months
    const start = document.getElementById('startMonth').value;
    const end = document.getElementById('endMonth').value;
    const params = new URLSearchParams();
    if (selectedSupplierIds.size > 0 && selectedSupplierIds.size !== suppliersData.length) {
      params.append('supplier', Array.from(selectedSupplierIds).join(','));
    }
    if (selectedDocTypes.size > 0 && selectedDocTypes.size !== docTypesData.length) {
      params.append('type', Array.from(selectedDocTypes).join(','));
    }
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    const query = params.toString() ? `?${params.toString()}` : '';
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
 * Render a list of documents into the list-group container.
 * Each document is displayed as a list-group-item with its type, number, supplier,
 * issue date and total amount. A download button allows the user to obtain the PDF summary.
 * @param {Array} docs
 */
function renderDocumentList(docs) {
  const container = document.getElementById('docs-list');
  container.innerHTML = '';
  docs.forEach((doc) => {
    const item = document.createElement('div');
    item.classList.add('list-group-item');
    // Header row: document type and number with download button on the right
    const header = document.createElement('div');
    header.classList.add('d-flex', 'justify-content-between', 'align-items-start');
    // Title with doc type and number
    const title = document.createElement('div');
    const typeLabel = doc.doc_type || doc.filetype.toUpperCase();
    const numberLabel = doc.invoice_number ? `N° ${doc.invoice_number}` : '';
    title.innerHTML = `<strong>${typeLabel}</strong> ${numberLabel}`;
    header.appendChild(title);
    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.classList.add('btn', 'btn-primary', 'btn-sm');
    downloadBtn.textContent = 'Descargar';
    downloadBtn.addEventListener('click', () => downloadDocument(doc.id, doc.filename));
    header.appendChild(downloadBtn);
    item.appendChild(header);
    // Supplier name
    const supplier = document.createElement('div');
    supplier.classList.add('fw-bold');
    supplier.textContent = doc.supplier_name || doc.filename || '-';
    item.appendChild(supplier);
    // Details: issue date and total amount
    const details = document.createElement('small');
    const issueDate = doc.doc_date ? new Date(doc.doc_date).toLocaleDateString() : '-';
    const total = doc.invoice_total != null ? parseFloat(doc.invoice_total) : 0;
    const totalStr = total ? '$' + total.toLocaleString('es-CL') : '-';
    details.innerHTML = `Documento emitido el ${issueDate} por un monto de ${totalStr}`;
    item.appendChild(details);
    container.appendChild(item);
  });
}

// -----------------------------------------------------------------------------
// Manual product category assignment functions
//
/**
 * Fetch list of all unique products from the backend and build the product
 * selection list for manual categorisation. Each product can be selected via
 * checkbox. A search input allows filtering the list by name.
 */
async function loadProductsForAssignment() {
  try {
    const response = await fetch(`${API_BASE_URL}/products`);
    const data = await response.json();
    productsData = data.products || [];
    // Initially select nothing
    selectedCategoryProducts = new Set();
    buildProductAssignmentList();
  } catch (err) {
    console.error('Error al cargar lista de productos:', err);
  }
}

/**
 * Build the UI list of products for assignment. Each product is rendered as a
 * checkbox within a scrollable container. Selection is tracked in
 * selectedCategoryProducts. A search input above filters visible entries.
 */
function buildProductAssignmentList() {
  const container = document.getElementById('categoryProductList');
  if (!container) return;
  container.innerHTML = '';
  productsData.forEach((name) => {
    const div = document.createElement('div');
    div.classList.add('form-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.classList.add('form-check-input');
    // Use a safe id by replacing non-alphanumeric chars
    const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
    input.id = `prod_assign_${safeId}`;
    input.value = name;
    input.addEventListener('change', () => {
      if (input.checked) {
        selectedCategoryProducts.add(name);
      } else {
        selectedCategoryProducts.delete(name);
      }
    });
    const label = document.createElement('label');
    label.classList.add('form-check-label');
    label.setAttribute('for', input.id);
    label.textContent = name;
    div.appendChild(input);
    div.appendChild(label);
    container.appendChild(div);
  });
  // Attach search handler if search input exists
  const searchInput = document.getElementById('categoryProductSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim().toLowerCase();
      productsData.forEach((name) => {
        const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
        const div = document.getElementById(`prod_assign_${safeId}`)?.parentElement;
        if (div) {
          const match = name.toLowerCase().includes(term);
          div.style.display = match ? '' : 'none';
        }
      });
    });
  }
}

/**
 * Load available categories for the category assignment dropdown. Categories are
 * derived from the current categories analytics (keys) and any manually
 * assigned categories stored in product_categories. If no categories are
 * available, the dropdown remains empty.
 */
async function loadCategoriesForSelect() {
  try {
    // Fetch categories summary to get existing category names
    const response = await fetch(`${API_BASE_URL}/analytics/categories`);
    const data = await response.json();
    const categories = data.categories ? Object.keys(data.categories) : [];
    // Also fetch manually assigned categories
    const resp2 = await fetch(`${API_BASE_URL}/product_categories`);
    const data2 = await resp2.json();
    const manualCats = data2.categories ? data2.categories.map((c) => c.category) : [];
    // Combine and deduplicate categories
    const allCategories = Array.from(new Set([...categories, ...manualCats]));
    const select = document.getElementById('categorySelect');
    if (!select) return;
    select.innerHTML = '';
    allCategories.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error al cargar categorías:', err);
  }
}

/**
 * Assign the selected products to the selected category via backend API. On
 * success, reload category chart to reflect new categorisations and clear
 * selection.
 */
async function assignSelectedCategory() {
  const categorySelect = document.getElementById('categorySelect');
  if (!categorySelect) return;
  const category = categorySelect.value;
  if (!category) {
    alert('Seleccione una categoría para asignar');
    return;
  }
  const products = Array.from(selectedCategoryProducts);
  if (products.length === 0) {
    alert('Seleccione al menos un producto para asignar');
    return;
  }
  try {
    const resp = await fetch(`${API_BASE_URL}/product_categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products, category }),
    });
    const resData = await resp.json();
    if (!resp.ok) {
      throw new Error(resData.error || 'Error al asignar categorías');
    }
    // On success, reload category chart and categories list
    await loadCategoryChart();
    await loadCategoriesForSelect();
    // Clear selections
    selectedCategoryProducts.clear();
    // Uncheck all checkboxes
    productsData.forEach((name) => {
      const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
      const checkbox = document.getElementById(`prod_assign_${safeId}`);
      if (checkbox) checkbox.checked = false;
    });
    alert('Categorías asignadas con éxito');
  } catch (err) {
    alert(err.message);
  }
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

// -----------------------------------------------------------------------------
// Supplier filter helper functions

/**
 * Populate the supplier filter options with checkboxes based on suppliersData.
 * This function rebuilds the list whenever suppliers or selections change.
 */
function buildSupplierOptions() {
  const optionsContainer = document.getElementById('supplierOptions');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';
  suppliersData.forEach((s) => {
    const div = document.createElement('div');
    div.classList.add('form-check');
    const input = document.createElement('input');
    input.classList.add('form-check-input');
    input.type = 'checkbox';
    input.id = `supplier_option_${s.id}`;
    input.value = s.id;
    input.checked = selectedSupplierIds.has(s.id);
    input.addEventListener('change', () => {
      if (input.checked) {
        selectedSupplierIds.add(s.id);
      } else {
        selectedSupplierIds.delete(s.id);
      }
      updateSelectAllCheckbox();
      updateSupplierFilterText();
      applySupplierFilter();
    });
    const label = document.createElement('label');
    label.classList.add('form-check-label');
    label.setAttribute('for', input.id);
    label.textContent = s.name;
    div.appendChild(input);
    div.appendChild(label);
    optionsContainer.appendChild(div);
  });
  updateSelectAllCheckbox();
  updateSupplierFilterText();
}

/**
 * Update the "Seleccionar todo" checkbox state based on selectedSupplierIds.
 */
function updateSelectAllCheckbox() {
  const selectAll = document.getElementById('supplierSelectAll');
  if (!selectAll) return;
  selectAll.checked = selectedSupplierIds.size === suppliersData.length;
}

/**
 * Update the supplier filter button text based on the selection count.
 */
function updateSupplierFilterText() {
  const textEl = document.getElementById('supplierFilterText');
  if (!textEl) return;
  if (selectedSupplierIds.size === 0 || selectedSupplierIds.size === suppliersData.length) {
    textEl.textContent = 'Todos';
  } else {
    textEl.textContent = `${selectedSupplierIds.size} seleccionados`;
  }
}

/**
 * Apply the supplier filter by reloading documents and charts.
 */
async function applySupplierFilter() {
  await loadDocuments();
  await loadProductChart();
  await loadCategoryChart();
}

// -----------------------------
// Document type filter functions
// -----------------------------

/**
 * Fetch the list of document types from backend and build the filter options.
 */
async function loadDocumentTypes() {
  try {
    const response = await fetch(`${API_BASE_URL}/document_types`);
    const data = await response.json();
    docTypesData = data.types || [];
    // Select all types by default if none selected yet
    if (selectedDocTypes.size === 0) {
      docTypesData.forEach((t) => selectedDocTypes.add(t));
    }
    buildDocTypeOptions();
  } catch (err) {
    console.error('Error al cargar tipos de documento:', err);
  }
}

/**
 * Build the checkboxes inside the document type filter dropdown.
 */
function buildDocTypeOptions() {
  const container = document.getElementById('docTypeOptions');
  if (!container) return;
  container.innerHTML = '';
  docTypesData.forEach((type) => {
    const div = document.createElement('div');
    div.classList.add('form-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.classList.add('form-check-input');
    const safeId = type.replace(/[^a-zA-Z0-9]/g, '_');
    input.id = `doctype_option_${safeId}`;
    input.value = type;
    input.checked = selectedDocTypes.has(type);
    input.addEventListener('change', () => {
      if (input.checked) {
        selectedDocTypes.add(type);
      } else {
        selectedDocTypes.delete(type);
      }
      updateDocTypeSelectAllCheckbox();
      updateDocTypeFilterText();
      applyDocTypeFilter();
    });
    const label = document.createElement('label');
    label.classList.add('form-check-label');
    label.setAttribute('for', input.id);
    label.textContent = type;
    div.appendChild(input);
    div.appendChild(label);
    container.appendChild(div);
  });
  updateDocTypeSelectAllCheckbox();
  updateDocTypeFilterText();
}

/**
 * Update the select-all checkbox for document types based on current selection.
 */
function updateDocTypeSelectAllCheckbox() {
  const selectAll = document.getElementById('docTypeSelectAll');
  if (!selectAll) return;
  selectAll.checked = selectedDocTypes.size === docTypesData.length;
}

/**
 * Update the document type filter button text to reflect selection state.
 */
function updateDocTypeFilterText() {
  const textEl = document.getElementById('docTypeFilterText');
  if (!textEl) return;
  if (selectedDocTypes.size === 0 || selectedDocTypes.size === docTypesData.length) {
    textEl.textContent = 'Todos';
  } else {
    textEl.textContent = `${selectedDocTypes.size} seleccionados`;
  }
}

/**
 * Apply the document type filter by reloading documents and charts.
 */
async function applyDocTypeFilter() {
  await loadDocuments();
  await loadProductChart();
  await loadCategoryChart();
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