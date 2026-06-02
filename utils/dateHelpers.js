/**
 * Convierte timestamps de Firestore a objetos Date de JavaScript
 * @param {any} value - Valor del timestamp (puede ser Timestamp de Firestore o Date)
 * @returns {Date|null} Objeto Date o null si el valor es inválido
 */
function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Formatea una fecha al formato es-ES
 * @param {Date|Timestamp|null} date - Fecha a formatear
 * @returns {string} Fecha formateada como string
 */
function formatDateEs(date) {
  if (!date) return 'pendiente';
  const jsDate = toJsDate(date);
  return jsDate ? jsDate.toLocaleDateString('es-ES') : 'pendiente';
}

/**
 * Verifica si una fecha está vencida
 * @param {Date|Timestamp|null} dueDate - Fecha de vencimiento
 * @returns {boolean} true si está vencida
 */
function isOverdue(dueDate) {
  if (!dueDate) return false;
  const jsDate = toJsDate(dueDate);
  return jsDate ? jsDate < new Date() : false;
}

/**
 * Obtiene el estado de una factura o cargo
 * @param {string} status - Estado actual ('pending', 'paid', 'overdue')
 * @param {Date|Timestamp|null} dueDate - Fecha de vencimiento
 * @returns {string} Estado actualizado considerando si está vencido
 */
function getPaymentStatus(status, dueDate) {
  if (status === 'paid') return 'paid';
  if (status === 'pending' && isOverdue(dueDate)) return 'overdue';
  return status;
}

/**
 * Convierte fecha a timestamp en millisegundos
 * @param {Date|Timestamp|string|null} value - Valor a convertir
 * @returns {number} Timestamp en ms, 0 si inválido
 */
function toDateMs(value) {
  const jsDate = toJsDate(value);
  return jsDate ? jsDate.getTime() : 0;
}

/**
 * Obtiene los límites de un día en millisegundos
 * @param {Date|string} dateInput - Fecha de referencia
 * @returns {object} { dayStartMs, dayEndMs } límites del día
 */
function getDayBounds(dateInput) {
  const dayStart = new Date(dateInput);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 86400000; // +1 día en ms
  return { dayStartMs, dayEndMs };
}

/**
 * Compara si dos fechas están en el mismo día
 * @param {Date|Timestamp|string} date1 - Primera fecha
 * @param {Date|Timestamp|string} date2 - Segunda fecha
 * @returns {boolean} true si están en el mismo día
 */
function isSameDay(date1, date2) {
  const ms1 = toDateMs(date1);
  const ms2 = toDateMs(date2);
  if (!ms1 || !ms2) return false;
  
  const { dayStartMs: start1, dayEndMs: end1 } = getDayBounds(new Date(ms1));
  return ms2 >= start1 && ms2 < end1;
}

module.exports = {
  toJsDate,
  formatDateEs,
  isOverdue,
  getPaymentStatus,
  toDateMs,
  getDayBounds,
  isSameDay,
};
