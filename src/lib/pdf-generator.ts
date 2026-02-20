'use client';
import jsPDF from 'jspdf';
import type { Transaction, Vehicle } from '@/lib/types';
import { formatCurrency } from './utils';

export const generateReceiptPdf = (transaction: Transaction, vehicle: Vehicle | null): Blob => {
    const doc = new jsPDF();

    // Company Name Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Spillway Car Wash & Grill', 105, 20, { align: 'center' });

    // Receipt Title
    doc.setFontSize(18);
    doc.text('Official Receipt', 105, 30, { align: 'center' });
    
    doc.setLineWidth(0.2);
    doc.line(15, 35, 195, 35);

    // Transaction Details
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    let yPosition = 45;
    doc.text(`Receipt ID: ${transaction.id}`, 15, yPosition);
    doc.text(`Date: ${new Date(transaction.timestamp).toLocaleString()}`, 15, yPosition += 7);
    doc.text(`License Plate: ${transaction.licensePlate}`, 15, yPosition += 7);
    if (vehicle?.ownerName) {
        doc.text(`Owner: ${vehicle.ownerName}`, 15, yPosition += 7);
    }
    yPosition += 10;

    // Services Table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Services Rendered', 15, yPosition);
    doc.setLineWidth(0.5);
    doc.line(15, yPosition + 2, 195, yPosition + 2);

    yPosition += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    transaction.services.forEach(service => {
        doc.text(service.name, 20, yPosition);
        doc.text(formatCurrency(service.price), 195, yPosition, { align: 'right' });
        yPosition += 8;
    });

    // Total
    yPosition += 2;
    doc.setLineWidth(0.5);
    doc.line(15, yPosition, 195, yPosition);
    yPosition += 8;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Total Amount:', 15, yPosition);
    doc.text(formatCurrency(transaction.totalAmount), 195, yPosition, { align: 'right' });

    yPosition += 8;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Payment Method:', 15, yPosition);
    doc.text(transaction.payment.method, 195, yPosition, { align: 'right' });

    // Footer
    yPosition = 270;
    doc.setFontSize(10);
    doc.text('Thank you for choosing Spillway Car Wash & Grill!', 105, yPosition, { align: 'center' });
    doc.text('Opening Hours: Monday - Sunday', 105, yPosition + 5, { align: 'center' });

    // Return the PDF as a blob instead of saving it directly.
    return doc.output('blob');
};
