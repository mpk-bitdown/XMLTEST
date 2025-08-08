"""
Flask-based backend for a simple task management application.

This module defines a RESTful API for creating, reading, updating and deleting
task objects stored in a SQLite database. It uses SQLAlchemy for ORM
functionality and Flask-CORS to allow requests from the front‑end, which
resides in a different origin when served via static files.

Endpoints:
    GET    /api/tasks           – return all tasks
    POST   /api/tasks           – create a new task
    PUT    /api/tasks/<int:id>   – update an existing task
    DELETE /api/tasks/<int:id>   – delete a task

To run the server locally, install the dependencies listed in requirements.txt
and execute this file. When started, the app will create the database if
necessary and listen on port 5000.
"""

from __future__ import annotations

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename
import os
from datetime import datetime
from typing import Any, Dict
from xml.etree import ElementTree
from PyPDF2 import PdfReader
import io
import pandas as pd
# Use the pure-Python fpdf2 library to generate PDF summaries without requiring
# native compilation, which improves compatibility across environments.
from fpdf import FPDF

app = Flask(__name__)
# Directory to store uploaded documents
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///documents.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

db = SQLAlchemy(app)

# Enable CORS for API routes. In Flask-CORS 4.x the default no longer allows all origins.
# We allow any origin (including 'null' file origins) and support credentials. The
# send_wildcard option instructs Flask-CORS to echo '*' in the Access-Control-Allow-Origin
# header even when the request origin is 'null'.
# Configure CORS to allow any origin (including 'null').
# We set send_wildcard=True so that '*' is always sent in Access-Control-Allow-Origin,
# which permits 'null' origins when the frontend is opened from the filesystem. Note
# that supports_credentials cannot be used with '*' origins.
CORS(app, resources={r"/api/*": {"origins": "*"}}, send_wildcard=True)

# ---------------------------------------------------------------------------
# Utility function to clear all documents and related data
def _delete_all_documents() -> None:
    """Remove all records from the database and delete uploaded files."""
    # Remove uploaded files
    docs = Document.query.all()
    for doc in docs:
        try:
            os.remove(os.path.join(app.config["UPLOAD_FOLDER"], doc.filename))
        except FileNotFoundError:
            pass
    # Clear tables
    db.session.query(Item).delete()
    db.session.query(Document).delete()
    db.session.query(Supplier).delete()
    db.session.commit()



class Supplier(db.Model):
    """Represents a supplier (emisor) extracted from documents."""

    __tablename__ = "suppliers"
    id = db.Column(db.Integer, primary_key=True)
    rut = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    documents = db.relationship("Document", back_populates="supplier")

    def as_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "rut": self.rut, "name": self.name}


class Document(db.Model):
    """Represents an uploaded document (PDF or XML) or DTE envelope."""

    __tablename__ = "documents"

    id: int = db.Column(db.Integer, primary_key=True)
    filename: str = db.Column(db.String(255), nullable=False)
    filetype: str = db.Column(db.String(10), nullable=False)
    pages: int | None = db.Column(db.Integer, nullable=True)
    xml_root: str | None = db.Column(db.String(120), nullable=True)
    size_bytes: int = db.Column(db.Integer, nullable=False)
    upload_date: datetime = db.Column(db.DateTime, default=datetime.utcnow)
    # Número de factura (folio) extraído del XML. Puede ser None si se trata
    # de un documento PDF o no se encontró el campo Folio en el XML.
    invoice_number: str | None = db.Column(db.String(50), nullable=True)
    # Dirección de la factura extraída del XML. Puede ser None cuando no
    # existe la información en el XML o no se trata de un documento DTE.
    invoice_address: str | None = db.Column(db.String(255), nullable=True)
    # Relationships/foreign keys
    supplier_id = db.Column(db.Integer, db.ForeignKey("suppliers.id"), nullable=True)
    doc_date = db.Column(db.Date, nullable=True)  # Date of the document (e.g., FchEmis)
    supplier = db.relationship("Supplier", back_populates="documents")
    items = db.relationship("Item", back_populates="document", cascade="all, delete-orphan")

    def as_dict(self) -> Dict[str, Any]:
        """
        Convert document instance into a serializable dict including supplier and invoice details.

        Returns:
            dict: metadata for the document, including supplier name, RUT and total invoice value.
        """
        data = {
            "id": self.id,
            "filename": self.filename,
            "filetype": self.filetype,
            "pages": self.pages,
            "xml_root": self.xml_root,
            "size_bytes": self.size_bytes,
            "upload_date": self.upload_date.isoformat(),
            "doc_date": self.doc_date.isoformat() if self.doc_date else None,
            "invoice_number": self.invoice_number,
            "invoice_address": self.invoice_address,
        }
        # Include supplier name and RUT if available
        if self.supplier:
            data["supplier_rut"] = self.supplier.rut
            data["supplier_name"] = self.supplier.name
        # Compute invoice total by summing item totals or quantity*price
        total_value = 0.0
        for itm in self.items:
            if itm.total is not None:
                total_value += float(itm.total)
            elif itm.quantity is not None and itm.price is not None:
                total_value += float(itm.quantity) * float(itm.price)
        data["invoice_total"] = total_value
        return data


class Item(db.Model):
    """Represents an item (product) extracted from a document."""

    __tablename__ = "items"
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey("documents.id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    quantity = db.Column(db.Float, nullable=True)
    price = db.Column(db.Float, nullable=True)  # unit price
    total = db.Column(db.Float, nullable=True)  # total price for the line
    document = db.relationship("Document", back_populates="items")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "document_id": self.document_id,
            "name": self.name,
            "quantity": self.quantity,
            "price": self.price,
            "total": self.total,
        }


def create_tables() -> None:
    """Create the database tables at start up.

    For simplicity in this demo, we drop all existing tables and recreate them to
    apply schema changes. In a production application, use a migration tool
    like Alembic instead of dropping data.
    """
    with app.app_context():
        # Drop existing tables (if any) and recreate them. This will erase data.
        db.drop_all()
        db.create_all()


def extract_document_metadata(filepath: str, filetype: str) -> Dict[str, Any]:
    """Extract metadata from a document based on its type.

    For PDFs, returns the number of pages. For XMLs, returns the root tag.
    """
    metadata: Dict[str, Any] = {"pages": None, "xml_root": None}
    if filetype.lower() == "pdf":
        try:
            reader = PdfReader(filepath)
            metadata["pages"] = len(reader.pages)
        except Exception:
            metadata["pages"] = None
    elif filetype.lower() == "xml":
        try:
            tree = ElementTree.parse(filepath)
            metadata["xml_root"] = tree.getroot().tag
        except Exception:
            metadata["xml_root"] = None
    return metadata


@app.route("/api/documents", methods=["GET"])
def list_documents() -> tuple[Dict[str, Any], int]:
    """
    Return a list of uploaded documents along with their metadata.

    Optional query parameters allow filtering the returned documents by
    supplier and/or by a date range.

    Query parameters:
        supplier (str|int): Supplier id or name to filter. If numeric, treated as id.
        start (str): Start month in YYYY-MM format. Documents with a doc_date on or
            after the first day of the month are included.
        end (str): End month in YYYY-MM format. Documents with a doc_date on or
            before the last day of the month are included.

    Returns:
        dict: {"documents": [doc.as_dict(), ...]}
    """
    supplier_param = request.args.get("supplier")
    invoice_param = request.args.get("invoice")
    start_param = request.args.get("start")
    end_param = request.args.get("end")
    # Start with base query
    query = Document.query
    # Join supplier table if supplier filter provided
    if supplier_param:
        # Determine if numeric id or name
        if supplier_param.isdigit():
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.id == int(supplier_param))
        else:
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.name == supplier_param)
    # Date filters on doc_date
    if start_param:
        try:
            start_dt = datetime.strptime(start_param, "%Y-%m").date()
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date >= start_dt)
        except Exception:
            pass
    # Invoice number filter (partial match)
    if invoice_param:
        # apply case-insensitive like filter
        query = query.filter(Document.invoice_number != None)
        like_pattern = f"%{invoice_param}%"
        query = query.filter(Document.invoice_number.ilike(like_pattern))
    if end_param:
        try:
            from calendar import monthrange
            end_dt = datetime.strptime(end_param, "%Y-%m")
            year, month = end_dt.year, end_dt.month
            last_day = monthrange(year, month)[1]
            end_date = datetime(year, month, last_day).date()
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date <= end_date)
        except Exception:
            pass
    docs = query.order_by(Document.upload_date.desc()).all()
    return {"documents": [doc.as_dict() for doc in docs]}, 200


@app.route("/api/documents", methods=["POST"])
def upload_document() -> tuple[Dict[str, Any], int]:
    """Handle uploading of one or multiple documents.

    Supports multipart/form-data with either a single file field named 'file' or
    multiple files under 'files'. Only PDF and XML files are accepted.
    Returns a list of created documents.
    """
    # Determine if multiple files are provided
    files = []
    if 'files' in request.files:
        files = request.files.getlist('files')
    elif 'file' in request.files:
        files = [request.files['file']]
    else:
        return {"error": "No file(s) part in the request."}, 400
    created_docs = []
    for upload in files:
        if upload.filename == '':
            # Skip empty file entries
            continue
        filename = secure_filename(upload.filename)
        ext = os.path.splitext(filename)[1].lower().lstrip('.')
        if ext not in {"pdf", "xml"}:
            # Skip unsupported types but do not interrupt processing other files
            continue
        # Ensure unique filename in upload folder
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(filepath):
            base, extension = os.path.splitext(filename)
            filename = f"{base}_{int(datetime.utcnow().timestamp())}{extension}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        # Save file
        upload.save(filepath)
        size = os.path.getsize(filepath)
        meta = extract_document_metadata(filepath, ext)
        # If XML file: parse and extract supplier, document date and items
        if ext == "xml":
            try:
                import xml.etree.ElementTree as ET
                ns = {'sii': 'http://www.sii.cl/SiiDte'}
                tree = ET.parse(filepath)
                root_xml = tree.getroot()
                # Determine root tag for metadata
                xml_root_tag = root_xml.tag.split('}')[-1] if '}' in root_xml.tag else root_xml.tag
                # Iterate over all DTE documents within XML
                for idx, dte in enumerate(root_xml.findall('.//sii:DTE', ns)):
                    # Extract supplier info
                    emisor = dte.find('.//sii:Emisor', ns)
                    rut_emisor = None
                    nombre_emisor = None
                    if emisor is not None:
                        rut_emisor = emisor.findtext('sii:RUTEmisor', default='', namespaces=ns)
                        # Some DTE documents use different tag names
                        nombre_emisor = (
                            emisor.findtext('sii:RznSoc', default='', namespaces=ns)
                            or emisor.findtext('sii:RznSocEmisor', default='', namespaces=ns)
                        )
                    # Find or create supplier
                    supplier = None
                    if rut_emisor:
                        supplier = Supplier.query.filter_by(rut=rut_emisor).first()
                        if supplier is None:
                            supplier = Supplier(rut=rut_emisor, name=nombre_emisor or rut_emisor)
                            db.session.add(supplier)
                    # Document date and metadata extracted from IdDoc
                    iddoc = dte.find('.//sii:IdDoc', ns)
                    doc_date = None
                    invoice_number = None
                    if iddoc is not None:
                        # Extract invoice date
                        date_text = iddoc.findtext('sii:FchEmis', default='', namespaces=ns)
                        if date_text:
                            try:
                                doc_date = datetime.strptime(date_text, '%Y-%m-%d').date()
                            except Exception:
                                doc_date = None
                        # Extract invoice number (Folio) if present
                        folio_text = iddoc.findtext('sii:Folio', default='', namespaces=ns)
                        invoice_number = folio_text.strip() if folio_text else None
                        if invoice_number == '':
                            invoice_number = None
                    # Extract invoice address from receptor data
                    invoice_address = None
                    receptor = dte.find('.//sii:Receptor', ns)
                    if receptor is not None:
                        # Try to get delivery address (DirRecep) or fallback to DirRecep if variants differ
                        addr = receptor.findtext('sii:DirRecep', default='', namespaces=ns)
                        if not addr:
                            # Some schemas may use DirRecep or DirDest for address; check both
                            addr = receptor.findtext('sii:DirDest', default='', namespaces=ns)
                        invoice_address = addr.strip() if addr else None
                    # Create document record per DTE with invoice number and address
                    doc = Document(
                        filename=filename,
                        filetype=ext,
                        pages=None,
                        xml_root=xml_root_tag,
                        size_bytes=size,
                        supplier=supplier,
                        doc_date=doc_date,
                        invoice_number=invoice_number,
                        invoice_address=invoice_address,
                    )
                    db.session.add(doc)
                    created_docs.append(doc)
                    # Extract items
                    for det in dte.findall('.//sii:Detalle', ns):
                        name_item = det.findtext('sii:NmbItem', default='', namespaces=ns)
                        qty_text = det.findtext('sii:QtyItem', default='', namespaces=ns)
                        price_text = det.findtext('sii:PrcItem', default='', namespaces=ns)
                        total_text = det.findtext('sii:MontoItem', default='', namespaces=ns)
                        try:
                            quantity = float(qty_text) if qty_text else None
                        except Exception:
                            quantity = None
                        try:
                            price = float(price_text) if price_text else None
                        except Exception:
                            price = None
                        try:
                            total = float(total_text) if total_text else None
                        except Exception:
                            total = None
                        item = Item(
                            document=doc,
                            name=name_item,
                            quantity=quantity,
                            price=price,
                            total=total,
                        )
                        db.session.add(item)
            except Exception:
                # Fallback: if parsing fails, create a single document record without items
                doc = Document(
                    filename=filename,
                    filetype=ext,
                    pages=None,
                    xml_root=meta.get("xml_root"),
                    size_bytes=size,
                )
                db.session.add(doc)
                created_docs.append(doc)
        else:
            # Non-XML file: create a simple document record
            doc = Document(
                filename=filename,
                filetype=ext,
                pages=meta.get("pages"),
                xml_root=meta.get("xml_root"),
                size_bytes=size,
            )
            db.session.add(doc)
            created_docs.append(doc)
    # Commit after processing all files
    db.session.commit()
    # Return list or single object for backwards compatibility
    if not created_docs:
        return {"error": "No valid files were uploaded."}, 400
    if len(created_docs) == 1:
        return created_docs[0].as_dict(), 201
    return {"documents": [d.as_dict() for d in created_docs]}, 201


@app.route("/api/documents/<int:doc_id>", methods=["GET"])
def get_document(doc_id: int) -> tuple[Dict[str, Any], int]:
    """Retrieve metadata of a single document.

    This endpoint does not return the file content itself but its metadata.
    """
    doc = Document.query.get(doc_id)
    if doc is None:
        return {"error": f"Documento con id {doc_id} no encontrado."}, 404
    return doc.as_dict(), 200


@app.route("/api/documents/<int:doc_id>/download", methods=["GET"])
def download_document(doc_id: int):
    """
    Generate a simple PDF summary of the document containing supplier details,
    items with quantities, unit prices and subtotals, and invoice totals.

    If the document does not exist, returns a 404 JSON error.
    """
    doc = Document.query.get(doc_id)
    if doc is None:
        return {"error": f"Documento con id {doc_id} no encontrado."}, 404
    # Generate PDF using fpdf2
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Arial", style="B", size=16)
    pdf.cell(0, 10, "Resumen de Factura", ln=True)
    pdf.ln(5)
    # Supplier info
    pdf.set_font("Arial", style="B", size=12)
    pdf.cell(40, 8, "Proveedor:")
    pdf.set_font("Arial", size=12)
    pdf.cell(0, 8, doc.supplier.name if doc.supplier else "-", ln=True)
    pdf.set_font("Arial", style="B", size=12)
    pdf.cell(40, 8, "RUT:")
    pdf.set_font("Arial", size=12)
    pdf.cell(0, 8, doc.supplier.rut if doc.supplier else "-", ln=True)
    pdf.set_font("Arial", style="B", size=12)
    pdf.cell(40, 8, "Fecha factura:")
    pdf.set_font("Arial", size=12)
    if doc.doc_date:
        pdf.cell(0, 8, doc.doc_date.strftime("%d/%m/%Y"), ln=True)
    else:
        pdf.cell(0, 8, "-", ln=True)
    pdf.ln(5)
    # Table headers
    pdf.set_font("Arial", style="B", size=11)
    pdf.cell(80, 8, "Producto", border=1)
    pdf.cell(30, 8, "Cantidad", border=1, align="R")
    pdf.cell(30, 8, "Precio", border=1, align="R")
    pdf.cell(40, 8, "Subtotal", border=1, align="R")
    pdf.ln()
    pdf.set_font("Arial", size=10)
    total_neto = 0.0
    for item in doc.items:
        qty = item.quantity or 0
        price = item.price or 0
        subtotal = item.total if item.total is not None else qty * price
        total_neto += subtotal or 0
        pdf.cell(80, 7, str(item.name), border=1)
        pdf.cell(30, 7, f"{qty:.2f}" if qty else "-", border=1, align="R")
        pdf.cell(30, 7, f"{price:,.0f}" if price else "-", border=1, align="R")
        pdf.cell(40, 7, f"{subtotal:,.0f}" if subtotal else "-", border=1, align="R")
        pdf.ln()
    # Totals
    pdf.ln(3)
    pdf.set_font("Arial", style="B", size=12)
    pdf.cell(80, 8, "Total neto:")
    pdf.set_font("Arial", size=12)
    pdf.cell(40, 8, f"{total_neto:,.0f}", align="R")
    pdf.ln()
    invoice_total = doc.as_dict().get("invoice_total", 0)
    pdf.set_font("Arial", style="B", size=12)
    pdf.cell(80, 8, "Total factura:")
    pdf.set_font("Arial", size=12)
    pdf.cell(40, 8, f"{invoice_total:,.0f}", align="R")
    # Output PDF as bytes
    # Retrieve PDF as a string or bytes; ensure we convert to bytes before sending
    pdf_data = pdf.output(dest="S")
    # fpdf2 may return a bytearray or string depending on version
    if isinstance(pdf_data, (bytes, bytearray)):
        pdf_bytes = bytes(pdf_data)
    else:
        # Encode string to Latin‑1 bytes
        pdf_bytes = pdf_data.encode("latin1")
    filename = f"factura_resumen_{doc.id}.pdf"
    return Response(pdf_bytes, headers={
        "Content-Type": "application/pdf",
        "Content-Disposition": f"attachment; filename={filename}"
    })

# ---------------------------------------------------------------------------
# Additional API endpoints for bulk deletion and Excel export

@app.route("/api/documents/delete_all", methods=["DELETE"])
def delete_all_documents() -> Any:
    """Delete all documents, suppliers and items from the database and uploads folder."""
    _delete_all_documents()
    return {"message": "Todos los documentos han sido eliminados"}, 200


@app.route("/api/analytics/products/export", methods=["GET"])
def export_products_excel() -> Any:
    """
    Export a summary of products in Excel format.

    Each row represents a single product. Columns include:
        - Producto: name of the product
        - Meses: concatenated list of months in which the product was purchased, in MMYYYY format (e.g., "012025-022025")
        - Proveedores: list of supplier names involved, separated by semicolons
        - RUT proveedores: list of supplier RUTs, separated by semicolons
        - Cantidad total: total quantity purchased across all months and suppliers
        - Precio mínimo: minimum unit price across all items
        - Precio máximo: maximum unit price across all items
        - Precio promedio: average unit price across all items

    Returns:
        A streaming response with the Excel file for download.
    """
    # Query aggregated data per product, along with month and supplier details
    rows = (
        db.session.query(
            Item.name.label("producto"),
            db.func.strftime('%m%Y', Document.doc_date).label("mes"),
            Supplier.name.label("proveedor"),
            Supplier.rut.label("rut_proveedor"),
            Item.quantity.label("cantidad"),
            Item.price.label("precio"),
            Document.invoice_number.label("invoice_number"),
            Document.invoice_address.label("invoice_address"),
        )
        .join(Document, Document.id == Item.document_id)
        .join(Supplier, Supplier.id == Document.supplier_id)
        .filter(Document.doc_date != None)
        .all()
    )
    # Organize data by product
    summary: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        prod = r.producto
        if prod not in summary:
            summary[prod] = {
                "meses": set(),
                "proveedores": set(),
                "rut_proveedores": set(),
                "facturas": set(),
                "direcciones": set(),
                "cantidades": [],
                "precios": [],
                "valores": [],  # total value per line (qty * price)
            }
        summary[prod]["meses"].add(r.mes)
        summary[prod]["proveedores"].add(r.proveedor)
        summary[prod]["rut_proveedores"].add(r.rut_proveedor)
        # Collect invoice numbers and addresses
        if r.invoice_number:
            summary[prod]["facturas"].add(str(r.invoice_number))
        if r.invoice_address:
            summary[prod]["direcciones"].add(str(r.invoice_address))
        if r.cantidad is not None:
            summary[prod]["cantidades"].append(float(r.cantidad))
        if r.precio is not None:
            summary[prod]["precios"].append(float(r.precio))
            # Compute value if quantity available
            if r.cantidad is not None:
                try:
                    summary[prod]["valores"].append(float(r.cantidad) * float(r.precio))
                except Exception:
                    pass
    # Build rows for DataFrame
    records = []
    for prod, info in summary.items():
        meses_sorted = sorted(info["meses"])
        meses_str = "-".join(meses_sorted)
        proveedores_str = "; ".join(sorted(info["proveedores"]))
        rut_str = "; ".join(sorted(info["rut_proveedores"]))
        facturas_str = "; ".join(sorted(info["facturas"])) if info["facturas"] else ""
        direcciones_str = "; ".join(sorted(info["direcciones"])) if info["direcciones"] else ""
        cantidades = info["cantidades"] or [0]
        precios = info["precios"] or [0]
        valores = info["valores"] or [0]
        total_qty = sum(cantidades)
        min_price = min(precios)
        max_price = max(precios)
        avg_price = sum(precios) / len(precios) if precios else 0
        total_value = sum(valores)
        records.append({
            "Producto": prod,
            "Meses": meses_str,
            "Proveedores": proveedores_str,
            "RUT proveedores": rut_str,
            "Facturas": facturas_str,
            "Direcciones": direcciones_str,
            "Cantidad total": total_qty,
            "Valor total": total_value,
            "Precio mínimo": min_price,
            "Precio máximo": max_price,
            "Precio promedio": avg_price,
        })
    # Create DataFrame
    df = pd.DataFrame(records)
    # Sort by product name
    df.sort_values(by="Producto", inplace=True)
    # Write to Excel in memory
    output = io.BytesIO()
    with pd.ExcelWriter(output) as writer:
        df.to_excel(writer, index=False, sheet_name="Productos")
    output.seek(0)
    # Return as response
    return (
        output.getvalue(),
        200,
        {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": "attachment; filename=productos.xlsx",
        },
    )


@app.route("/api/analytics/ai", methods=["GET"])
def ai_insights() -> Any:
    """
    Provide simple AI-driven insights and projections based on purchase data.

    Suggestions include identifying the most purchased product of the current year and
    projecting total quantities for each product by the end of the year based on
    average monthly consumption.

    Returns:
        A JSON object with "suggestions": list of strings, and "projections": dict.
    """
    now = datetime.now()
    current_year = now.year
    current_month = now.month
    # Aggregate total quantities per product for the current year
    product_totals = (
        db.session.query(
            Item.name,
            db.func.sum(Item.quantity).label("total_qty")
        )
        .join(Document, Document.id == Item.document_id)
        .filter(Document.doc_date != None)
        .filter(db.func.strftime('%Y', Document.doc_date) == str(current_year))
        .group_by(Item.name)
        .all()
    )
    projections = {}
    top_product = None
    top_qty = 0
    for name, total_qty in product_totals:
        qty = float(total_qty or 0)
        if qty > top_qty:
            top_qty = qty
            top_product = name
        avg_monthly = qty / current_month if current_month else qty
        projected_remaining = avg_monthly * (12 - current_month)
        projected_total = qty + projected_remaining
        projections[name] = {
            "cantidad_actual": qty,
            "promedio_mensual": avg_monthly,
            "proyeccion_restante": projected_remaining,
            "proyeccion_total": projected_total,
        }
    suggestions = []
    if top_product:
        suggestions.append(
            f"Hasta {now.strftime('%B %Y')}, el producto más comprado es '{top_product}' con {top_qty:.0f} unidades."
        )
        suggestions.append(
            f"Si mantienes el ritmo actual, proyectas comprar alrededor de {int(projections[top_product]['proyeccion_total'])} unidades de '{top_product}' en todo {current_year}."
        )
    else:
        suggestions.append("No se encontraron datos de compra para el año en curso.")
    return {"suggestions": suggestions, "projections": projections}, 200


@app.route("/api/dashboard", methods=["GET"])
def dashboard_data() -> tuple[Dict[str, Any], int]:
    """Return aggregated statistics for dashboard visualizations.

    Provides counts of documents per type, total size per type, and average pages
    for PDFs. XML documents will have pages as None. Also returns a list of
    file sizes for histogram representation.
    """
    docs = Document.query.all()
    stats = {
        "count_per_type": {},
        "total_size_per_type": {},
        "avg_pages": None,
        "file_sizes": [],
    }
    total_pages = 0
    pdf_count = 0
    for doc in docs:
        # Count documents per type
        stats["count_per_type"].setdefault(doc.filetype, 0)
        stats["count_per_type"][doc.filetype] += 1
        # Aggregate sizes
        stats["total_size_per_type"].setdefault(doc.filetype, 0)
        stats["total_size_per_type"][doc.filetype] += doc.size_bytes
        # Collect size list
        stats["file_sizes"].append(doc.size_bytes)
        # Aggregate pages for PDFs
        if doc.filetype == "pdf" and doc.pages is not None:
            pdf_count += 1
            total_pages += doc.pages
    if pdf_count:
        stats["avg_pages"] = total_pages / pdf_count
    return stats, 200


@app.route("/api/documents/csv", methods=["POST"])
def export_documents_csv():
    """Return a CSV file containing selected documents metadata.

    Expects JSON body with an "ids" list of document IDs. If no IDs are
    provided, exports all documents. The CSV includes headers: id,filename,
    filetype,pages,xml_root,size_bytes,upload_date.
    """
    data = request.get_json(silent=True) or {}
    ids = data.get("ids")
    # Query documents based on provided ids or all if none, with optional filters
    query = Document.query
    # If ids provided, filter by id list
    if ids:
        query = query.filter(Document.id.in_(ids))
    else:
        # When no ids provided, allow filtering by supplier and date range via query params
        supplier_param = request.args.get("supplier")
        start_param = request.args.get("start")
        end_param = request.args.get("end")
        if supplier_param:
            # Determine numeric id or name
            if supplier_param.isdigit():
                query = query.join(Supplier, Supplier.id == Document.supplier_id)
                query = query.filter(Supplier.id == int(supplier_param))
            else:
                query = query.join(Supplier, Supplier.id == Document.supplier_id)
                query = query.filter(Supplier.name == supplier_param)
        if start_param:
            try:
                start_dt = datetime.strptime(start_param, "%Y-%m").date()
                query = query.filter(Document.doc_date != None)
                query = query.filter(Document.doc_date >= start_dt)
            except Exception:
                pass
        if end_param:
            try:
                from calendar import monthrange
                end_dt = datetime.strptime(end_param, "%Y-%m")
                year, month = end_dt.year, end_dt.month
                last_day = monthrange(year, month)[1]
                end_date = datetime(year, month, last_day).date()
                query = query.filter(Document.doc_date != None)
                query = query.filter(Document.doc_date <= end_date)
            except Exception:
                pass
    docs = query.all()
    # Build CSV content
    import csv
    from io import StringIO
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id",
        "filename",
        "filetype",
        "pages",
        "xml_root",
        "size_bytes",
        "upload_date",
        "supplier_name",
        "supplier_rut",
        "doc_date",
        "invoice_total",
    ])
    for doc in docs:
        # Compute invoice total similar to Document.as_dict
        invoice_total = 0.0
        for itm in doc.items:
            if itm.total is not None:
                invoice_total += float(itm.total)
            elif itm.quantity is not None and itm.price is not None:
                invoice_total += float(itm.quantity) * float(itm.price)
        writer.writerow([
            doc.id,
            doc.filename,
            doc.filetype,
            doc.pages or "",
            doc.xml_root or "",
            doc.size_bytes,
            doc.upload_date.isoformat(),
            doc.supplier.name if doc.supplier else "",
            doc.supplier.rut if doc.supplier else "",
            doc.doc_date.isoformat() if doc.doc_date else "",
            invoice_total,
        ])
    csv_content = output.getvalue()
    output.close()
    return (
        csv_content,
        200,
        {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": "attachment; filename=documents.csv",
        },
    )


@app.route("/api/products", methods=["GET"])
def list_products():
    """Return a list of unique product names extracted from items."""
    products = db.session.query(Item.name).distinct().all()
    product_list = [p[0] for p in products]
    return {"products": product_list}, 200

# ---------------------------------------------------------------------------
# Additional API routes for suppliers, filtered product analytics, categories

@app.route("/api/suppliers", methods=["GET"])
def list_suppliers() -> tuple[Dict[str, Any], int]:
    """Return a list of all suppliers with their id, rut and name."""
    suppliers = Supplier.query.order_by(Supplier.name).all()
    return {
        "suppliers": [
            {"id": s.id, "rut": s.rut, "name": s.name} for s in suppliers
        ]
    }, 200


@app.route("/api/analytics/products/chart", methods=["GET"])
def products_chart() -> tuple[Dict[str, Any], int]:
    """
    Return aggregated product quantities and values based on optional filters.

    Query parameters:
        start (str): Start month in format YYYY-MM. Inclusive.
        end (str): End month in format YYYY-MM. Inclusive.
        supplier (str|int): Supplier id or name to filter. If numeric, treated as id.

    Response:
        dict: { "products": {product_name: {"total_qty": float, "total_value": float}} }
    """
    start_param = request.args.get("start")
    end_param = request.args.get("end")
    supplier_param = request.args.get("supplier")
    query = db.session.query(
        Item.name.label("producto"),
        db.func.sum(Item.quantity).label("total_qty"),
        db.func.sum(Item.quantity * Item.price).label("total_value"),
    ).join(Document, Document.id == Item.document_id)
    # Apply date filters if provided
    if start_param:
        try:
            start_date = datetime.strptime(start_param, "%Y-%m")
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date >= start_date.date())
        except Exception:
            pass
    if end_param:
        try:
            end_date = datetime.strptime(end_param, "%Y-%m")
            # To include the entire month, add one month and subtract a day
            # but since we just compare with <=, we can set to last day of month by using next month start minus one day
            from calendar import monthrange
            year, month = end_date.year, end_date.month
            last_day = monthrange(year, month)[1]
            end_full_date = datetime(year, month, last_day).date()
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date <= end_full_date)
        except Exception:
            pass
    # Apply supplier filter if provided
    if supplier_param:
        # Determine if numeric id or name
        if supplier_param.isdigit():
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.id == int(supplier_param))
        else:
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.name == supplier_param)
    result_rows = query.group_by(Item.name).all()
    products_summary: Dict[str, Dict[str, float]] = {}
    for prod, total_qty, total_value in result_rows:
        products_summary[prod] = {
            "total_qty": float(total_qty or 0),
            "total_value": float(total_value or 0),
        }
    return {"products": products_summary}, 200


@app.route("/api/analytics/categories", methods=["GET"])
def categories_analytics() -> tuple[Dict[str, Any], int]:
    """
    Compute product categories and aggregate quantities and values per category.

    Optional query parameters:
        start (str): Start month in format YYYY-MM. Inclusive.
        end (str): End month in format YYYY-MM. Inclusive.
        supplier (str|int): Supplier id or name to filter.

    Categories are inferred from product names using simple heuristics. Returns a
    dictionary of categories with total quantity and total value, along with a
    mapping of each product name to its category.
    """
    start_param = request.args.get("start")
    end_param = request.args.get("end")
    supplier_param = request.args.get("supplier")
    # Base query
    query = db.session.query(
        Item.name.label("producto"),
        db.func.sum(Item.quantity).label("total_qty"),
        db.func.sum(Item.quantity * Item.price).label("total_value"),
    ).join(Document, Document.id == Item.document_id)
    # Date filters
    if start_param:
        try:
            start_date = datetime.strptime(start_param, "%Y-%m").date()
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date >= start_date)
        except Exception:
            pass
    if end_param:
        try:
            from calendar import monthrange
            end_dt = datetime.strptime(end_param, "%Y-%m")
            year, month = end_dt.year, end_dt.month
            last_day = monthrange(year, month)[1]
            end_date = datetime(year, month, last_day).date()
            query = query.filter(Document.doc_date != None)
            query = query.filter(Document.doc_date <= end_date)
        except Exception:
            pass
    # Supplier filter
    if supplier_param:
        if supplier_param.isdigit():
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.id == int(supplier_param))
        else:
            query = query.join(Supplier, Supplier.id == Document.supplier_id)
            query = query.filter(Supplier.name == supplier_param)
    rows = query.group_by(Item.name).all()
    def classify(name: str) -> str:
        """
        Assign a product to one of several expanded categories based on keywords in its name.

        The categories cover a broad range of grocery and general merchandise items. If none of the
        keywords match, the product is assigned to "Otros".
        """
        lower = name.lower()
        # List of (category, [keywords]) tuples. Order matters: first match wins.
        categories_keywords = [
            ("Carnes", ["carne", "pollo", "vacuno", "res", "cerdo", "cordero", "jamón", "tocino", "salchicha"]),
            ("Pescados y Mariscos", ["pescado", "marisco", "atún", "salmón", "camaron", "merluza", "ostión", "chorito"]),
            ("Lácteos", ["queso", "leche", "yogur", "mantequilla", "crema", "manjar", "helado"]),
            ("Frutas", ["manzana", "plátano", "banana", "pera", "uva", "fresa", "frutilla", "mora", "fruta", "kiwi", "naranja", "melón", "durazno", "sandía", "piña"]),
            ("Verduras", ["tomate", "cebolla", "lechuga", "zanahoria", "papa", "verdura", "champiñón", "brocoli", "pimiento", "col", "espinaca", "berenjena", "zapallo", "pepino", "ajo"]),
            ("Panadería y Pastelería", ["pan", "bolleria", "bollería", "croissant", "baguette", "empanada", "empanada de horno", "torta", "pastel", "gallet", "postre", "queque"]),
            ("Snacks y Dulces", ["snack", "galleta", "chocolate", "dulce", "caramelo", "barra", "papas fritas", "chips", "maní", "nueces", "almendra"]),
            ("Cereales y Granos", ["arroz", "frijol", "lenteja", "poroto", "garbanzo", "cereal", "avena"]),
            ("Pastas y Harinas", ["pasta", "fideo", "harina", "spaghetti", "macarrón", "macarrones"]),
            ("Aceites y Condimentos", ["aceite", "sal", "azúcar", "especia", "condimento", "salsa", "aderezo", "vinagre", "mayonesa", "ketchup", "mostaza"]),
            ("Bebidas Alcohólicas", ["vino", "cerveza", "pisco", "ron", "whisky", "vodka", "licor", "champaña"]),
            ("Bebidas no Alcohólicas", ["agua", "soda", "jugo", "refresco", "gaseosa", "cola", "coca", "pepsi", "té", "café"]),
            ("Aseo y Limpieza", ["jabón", "detergente", "cloro", "limpiador", "desinfectante", "escoba", "esponja", "lavaloza", "trapeador"]),
            ("Higiene Personal", ["shampoo", "champú", "crema dental", "cepillo", "desodorante", "pañal", "toalla higiénica", "afeitar", "jabón corporal"]),
            ("Mascotas", ["perro", "gato", "mascota", "alimento para perros", "alimento para gatos", "arena sanitaria", "hueso"]),
            ("Bebé", ["leche infantil", "pañal", "bebé", "mamadera", "toallita húmeda"]),
            ("Congelados", ["congelado", "helado", "hielo", "frozen", "sorbete"]),
            ("Electrónicos y Tecnología", ["cable", "usb", "teléfono", "celular", "computador", "laptop", "batería", "cargador", "audífono"]),
            ("Herramientas y Ferretería", ["clavo", "martillo", "serrucho", "tornillo", "destornillador", "llave", "taladro", "alicate"]),
            ("Oficina y Papelería", ["cuaderno", "lápiz", "papel", "bolígrafo", "carpeta", "notebook", "impresora", "tinta"]),
            ("Otros", []),
        ]
        for category, keywords in categories_keywords[:-1]:
            for kw in keywords:
                if kw in lower:
                    return category
        return "Otros"
    categories_summary: Dict[str, Dict[str, float]] = {}
    product_categories: Dict[str, str] = {}
    for prod, total_qty, total_value in rows:
        category = classify(prod)
        product_categories[prod] = category
        if category not in categories_summary:
            categories_summary[category] = {"total_qty": 0.0, "total_value": 0.0}
        categories_summary[category]["total_qty"] += float(total_qty or 0)
        categories_summary[category]["total_value"] += float(total_value or 0)
    return {"categories": categories_summary, "products": product_categories}, 200


@app.route("/api/analytics/categories/export", methods=["GET"])
def export_categories_excel() -> Any:
    """
    Export categories summary to Excel.

    Each row contains:
        - Categoría
        - Cantidad total
        - Valor total

    Returns:
        An Excel file for download.
    """
    # Get categories data
    data, status = categories_analytics()
    categories_summary = data.get("categories", {})
    # Build dataframe
    records = []
    for cat, stats in categories_summary.items():
        records.append({
            "Categoría": cat,
            "Cantidad total": float(stats.get("total_qty", 0)),
            "Valor total": float(stats.get("total_value", 0)),
        })
    df = pd.DataFrame(records)
    output = io.BytesIO()
    with pd.ExcelWriter(output) as writer:
        df.to_excel(writer, index=False, sheet_name="Categorias")
    output.seek(0)
    return (
        output.getvalue(),
        200,
        {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": "attachment; filename=categorias.xlsx",
        },
    )


@app.route("/api/analytics", methods=["GET"])
def analytics():
    """Compute and return aggregated analytics for suppliers, products and monthly quantities.

    Query parameters:
        product (optional): name of a product to get detailed monthly quantity and price stats.
    """
    product_name = request.args.get("product")
    result: Dict[str, Any] = {}
    # Providers usage: count documents per supplier
    provider_counts = (
        db.session.query(Supplier.name, db.func.count(Document.id))
        .join(Document, Supplier.id == Document.supplier_id)
        .group_by(Supplier.id)
        .all()
    )
    result["providers_usage"] = {name: count for name, count in provider_counts}
    # Products summary: total quantity and price stats per product
    product_stats = (
        db.session.query(
            Item.name,
            db.func.count(Item.id).label("count_items"),
            db.func.sum(Item.quantity).label("total_qty"),
            db.func.min(Item.price).label("min_price"),
            db.func.max(Item.price).label("max_price"),
            db.func.avg(Item.price).label("avg_price"),
        )
        .group_by(Item.name)
        .all()
    )
    result["products_summary"] = {
        name: {
            "count_items": count,
            "total_qty": float(total_qty or 0),
            "min_price": float(min_price or 0),
            "max_price": float(max_price or 0),
            "avg_price": float(avg_price or 0),
        }
        for name, count, total_qty, min_price, max_price, avg_price in product_stats
    }
    # Monthly quantities across all products
    monthly_quantities = (
        db.session.query(
            db.func.strftime('%Y-%m', Document.doc_date).label("month"),
            db.func.sum(Item.quantity).label("total_qty"),
        )
        .join(Item, Document.id == Item.document_id)
        .filter(Document.doc_date != None)
        .group_by("month")
        .order_by("month")
        .all()
    )
    result["monthly_quantities"] = {month: float(total_qty or 0) for month, total_qty in monthly_quantities}
    # If product specified, compute monthly quantity and price stats for it
    if product_name:
        product_monthly = (
            db.session.query(
                db.func.strftime('%Y-%m', Document.doc_date).label("month"),
                db.func.sum(Item.quantity).label("total_qty"),
                db.func.min(Item.price).label("min_price"),
                db.func.max(Item.price).label("max_price"),
                db.func.avg(Item.price).label("avg_price"),
            )
            .join(Item, Document.id == Item.document_id)
            .filter(Item.name == product_name)
            .filter(Document.doc_date != None)
            .group_by("month")
            .order_by("month")
            .all()
        )
        result["product_monthly"] = {
            month: {
                "total_qty": float(total_qty or 0),
                "min_price": float(min_price or 0),
                "max_price": float(max_price or 0),
                "avg_price": float(avg_price or 0),
            }
            for month, total_qty, min_price, max_price, avg_price in product_monthly
        }
    return result, 200


if __name__ == "__main__":
    # Ensure tables exist before serving
    create_tables()
    app.run(debug=True)