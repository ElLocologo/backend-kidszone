const { db } = require('../config/firebase');
const {
  notifyBillingCreated,
  notifyPaymentReceived,
  resolveParentUidForStudent,
} = require('../services/notificationTriggers');
const { toJsDate } = require('../utils/dateHelpers');

// Crear cargo adicional (solo admin) - TODAS LAS FACTURAS SE BASAN EN CARGOS
// Tipos: tuition (mensualidad), enrollment (matrícula), material, uniform, activity, other
exports.createAdditionalCharge = async (req, res) => {
  try {
    const { studentId, description, amount, type, dueDate } = req.body;

    // Validación 1: Campos obligatorios
    if (!studentId || !description || !amount) {
      return res.status(400).json({ error: 'Estudiante, descripción y monto son requeridos' });
    }

    // Validación 2: Monto debe ser número válido > 0
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Monto debe ser un número mayor a 0' });
    }

    // Validación 3: Tipo debe ser válido
    const validTypes = ['tuition', 'enrollment', 'material', 'uniform', 'activity', 'other'];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ error: `Tipo inválido. Debe ser: ${validTypes.join(', ')}` });
    }

    // Validación 4: Estudiante debe existir
    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const chargeRef = await db.collection('additionalCharges').add({
      studentId,
      description: description.trim(),
      amount: parsedAmount,
      type: type || 'material',
      status: 'pending',
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      paidAt: null,
      createdBy: req.user.uid,
    });

    return res.status(201).json({
      message: 'Cargo adicional creado correctamente',
      chargeId: chargeRef.id,
      charge: {
        id: chargeRef.id,
        studentId,
        description,
        amount: parsedAmount,
        type: type || 'material',
        status: 'pending',
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        note: 'Tipos: tuition (mensualidad), enrollment (matrícula), material, uniform, activity, other',
      },
    });
  } catch (error) {
    console.error('[CHARGE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Obtener cargos adicionales de un estudiante
exports.getStudentCharges = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parentUid = req.user.uid;

    const allowedStudentIds = await getStudentIdsForParent(parentUid);

    if (!allowedStudentIds.includes(studentId)) {
      return res.status(403).json({ error: 'Acceso denegado: Este estudiante no está asociado a su cuenta.' });
    }

    const chargesSnapshot = await db
      .collection('additionalCharges')
      .where('studentId', '==', studentId)
      .get();

    const charges = chargesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        dueDate: toJsDate(data.dueDate),
      };
    });

    charges.sort((a, b) => {
      const ta = a.dueDate ? a.dueDate.getTime() : 0;
      const tb = b.dueDate ? b.dueDate.getTime() : 0;
      return tb - ta;
    });

    return res.json(charges);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Crear factura mensual - AGRUPA TODOS LOS CARGOS PENDIENTES DEL MES
// Suma mensualidad, matrícula, materiales y otros cargos del período seleccionado
exports.generateMonthlyBilling = async (req, res) => {
  try {
    const { month, year, studentId } = req.body;

    if (!month || !year) {
      return res.status(400).json({ error: 'Mes y año requeridos' });
    }

    const billingMonth = new Date(year, month - 1, 1);
    
    // Obtener todos los estudiantes si no se especifica uno
    let students = [];
    if (studentId) {
      const studentDoc = await db.collection('students').doc(studentId).get();
      if (studentDoc.exists) {
        students = [{ id: studentId, ...studentDoc.data() }];
      } else {
        return res.status(404).json({ error: 'Estudiante no encontrado' });
      }
    } else {
      const studentsSnapshot = await db.collection('students').get();
      students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (students.length === 0) {
        return res.status(400).json({ error: 'No hay estudiantes registrados' });
      }
    }

    // Crear factura para cada estudiante
    const createdBillings = [];
    for (const student of students) {
      try {
        // Validación: Estudiante debe tener enrollment válido
        if (!student.enrollment || !student.enrollment.courseId) {
          console.warn(`[BILLING] Estudiante ${student.id} sin enrollment válido - OMITIDO`);
          continue;
        }

        // Verificar si ya existe factura para este mes
        const existingBilling = await db.collection('billing')
          .where('studentId', '==', student.id)
          .where('month', '==', month)
          .where('year', '==', year)
          .get();

        if (!existingBilling.empty) {
          console.log(`[BILLING] Factura ya existe para estudiante ${student.id} en ${month}/${year}`);
          continue;
        }

        // CAMBIO: Ya no se obtiene tuition desde courses
        // Ahora todos los cargos (mensualidad, matrícula, etc.) se crean como "additionalCharges"
        
        // Obtener cargos pendientes (incluye mensualidad, matrícula, materiales, etc.)
        const chargesSnapshot = await db.collection('additionalCharges')
          .where('studentId', '==', student.id)
          .where('status', '==', 'pending')
          .get();

        // Filtrar en memoria por fecha (último día del mes seleccionado)
        const lastDayOfMonth = new Date(year, month, 0);
        const additionalCharges = chargesSnapshot.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter(charge => {
            if (!charge.dueDate) return true;
            const chargeDueDate = charge.dueDate instanceof Date ? charge.dueDate : charge.dueDate.toDate?.() || new Date(charge.dueDate);
            return chargeDueDate <= lastDayOfMonth;
          });

        // Sumar TODOS los cargos (ahora incluye mensualidad y matrícula como tipos de cargos)
        const totalAmount = additionalCharges.reduce((sum, charge) => sum + (parseFloat(charge.amount) || 0), 0);

        if (totalAmount === 0) {
          console.warn(`[BILLING] Estudiante ${student.id} no tiene cargos pendientes - OMITIDO`);
          continue;
        }

        const dueDateVal = new Date(year, month, 5);

        const billingRef = await db.collection('billing').add({
          studentId: student.id,
          parentEmail: (student.parentEmail || '').toLowerCase(),
          month,
          year,
          // Ahora todos los cargos están en el array "charges"
          charges: additionalCharges.map(c => ({
            id: c.id,
            description: c.description || '',
            amount: parseFloat(c.amount) || 0,
            type: c.type || 'other',
          })),
          totalAmount,
          status: 'pending',
          dueDate: dueDateVal,
          paidDate: null,
          createdAt: new Date(),
        });

        createdBillings.push(billingRef.id);
        console.log(`[BILLING] Factura creada para estudiante ${student.id}: ${billingRef.id} - Monto: $${totalAmount}`);

        // Notificar al padre (no rompe el flujo si falla)
        try {
          const parentUid = await resolveParentUidForStudent(student);
          if (parentUid) {
            await notifyBillingCreated(
              billingRef.id,
              {
                studentName: `${student.name || ''} ${student.lastName || ''}`.trim(),
                studentId: student.id,
                month,
                year,
                totalAmount,
                dueDate: dueDateVal,
              },
              parentUid
            );
          }
        } catch (notifyErr) {
          console.error('[BILLING] Error en notificación padre:', notifyErr.message);
        }
      } catch (studentErr) {
        console.error(`[BILLING] Error procesando estudiante ${student.id}:`, studentErr.message);
      }
    }

    return res.status(201).json({
      message: `${createdBillings.length} facturas generadas correctamente`,
      billingIds: createdBillings,
    });
  } catch (error) {
    console.error('[BILLING] Error generando facturas:', error);
    return res.status(500).json({ error: `Error: ${error.message}` });
  }
};

// Obtener facturas de un estudiante
exports.getStudentBilling = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parentUid = req.user.uid;

    const allowedStudentIds = await getStudentIdsForParent(parentUid);

    if (!allowedStudentIds.includes(studentId)) {
      return res.status(403).json({ error: 'Acceso denegado: Este estudiante no está asociado a su cuenta.' });
    }

    const billingSnapshot = await db
      .collection('billing')
      .where('studentId', '==', studentId)
      .get();

    const billings = await Promise.all(billingSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      
      // Obtener pagos registrados para esta factura
      const paymentsSnapshot = await db.collection('payments')
        .where('billingId', '==', doc.id)
        .get();
      
      const payments = paymentsSnapshot.docs.map(payDoc => ({
        id: payDoc.id,
        ...payDoc.data(),
        paidAt: toJsDate(payDoc.data().paidAt),
      }));

      return {
        id: doc.id,
        ...data,
        dueDate: toJsDate(data.dueDate),
        payments: payments,
        totalPaid: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
      };
    }));

    billings.sort((a, b) => {
      const yDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yDiff !== 0) return yDiff;
      return (b.month ?? 0) - (a.month ?? 0);
    });

    return res.json(billings);
  } catch (error) {
    console.error('[BILLING] Error en getStudentBilling:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Registrar pago (SOLO ADMIN) - Proceso manual cuando admin recibe dinero
exports.recordPayment = async (req, res) => {
  try {
    const { billingId, amount, method, reference } = req.body;

    // Validación 1: Campos obligatorios
    if (!billingId || !amount) {
      return res.status(400).json({ error: 'Factura y monto son requeridos' });
    }

    // Validación 2: Monto debe ser número válido > 0
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Monto debe ser un número mayor a 0' });
    }

    // Validación 3: Método debe ser válido
    const validMethods = ['cash', 'transfer', 'card', 'check'];
    if (method && !validMethods.includes(method)) {
      return res.status(400).json({ error: `Método inválido. Debe ser: ${validMethods.join(', ')}` });
    }

    // Validación 4: Factura debe existir
    const billingDoc = await db.collection('billing').doc(billingId).get();
    if (!billingDoc.exists) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const billingData = billingDoc.data();

    // Validación 5: Advertencia si pago es mayor al total (aunque es permitido)
    if (parsedAmount > billingData.totalAmount) {
      console.warn(`[PAYMENT] Advertencia: Pago de ${parsedAmount} > total de ${billingData.totalAmount}`);
    }

    // Obtener información del estudiante para la notificación
    const studentDoc = await db.collection('students').doc(billingData.studentId).get();
    const studentData = studentDoc.exists ? studentDoc.data() : {};
    const studentName = studentData
      ? `${(studentData.name || '').trim()} ${(studentData.lastName || '').trim()}`.trim()
      : 'Estudiante Desconocido';

    // Crear registro de pago
    const paymentRef = await db.collection('payments').add({
      billingId,
      studentId: billingData.studentId,
      amount: parsedAmount,
      method: method || 'transfer',
      reference: reference ? reference.trim() : '',
      status: 'completed',
      paidAt: new Date(),
      createdBy: req.user.uid,
    });

    // IMPORTANTE: Si el pago cubre el total, marcar factura y TODOS los cargos como PAID
    if (parsedAmount >= billingData.totalAmount) {
      await db.collection('billing').doc(billingId).update({
        status: 'paid',
        paidDate: new Date(),
      });

      // Marcar TODOS los cargos relacionados con esta factura como pagados
      if (billingData.charges && billingData.charges.length > 0) {
        for (const charge of billingData.charges) {
          await db.collection('additionalCharges').doc(charge.id).update({
            status: 'paid',
            paidAt: new Date(),
          });
        }
      }
    }

    // Notificar al padre que el pago fue registrado (NO ROMPE EL FLUJO SI FALLA)
    try {
      const parentUid = await resolveParentUidForStudent(studentData);
      if (parentUid) {
        await notifyPaymentReceived(
          paymentRef.id,
          {
            studentName,
            studentId: billingData.studentId,
            billingId,
            amount: parsedAmount,
            method: method || 'transfer',
          },
          parentUid
        );
      }
    } catch (notifyErr) {
      console.error('[PAYMENT] Error notificación:', notifyErr.message);
    }

    return res.status(201).json({
      message: 'Pago registrado correctamente',
      paymentId: paymentRef.id,
      payment: {
        id: paymentRef.id,
        billingId,
        amount: parsedAmount,
        method: method || 'transfer',
        reference: reference ? reference.trim() : '',
        status: 'completed',
        paidAt: new Date(),
      },
      billingSummary: {
        billingId,
        studentName,
        status: parsedAmount >= billingData.totalAmount ? 'paid' : 'pending',
        totalAmount: billingData.totalAmount,
        amountPaid: parsedAmount,
        remaining: Math.max(0, billingData.totalAmount - parsedAmount),
      },
    });
  } catch (error) {
    console.error('[PAYMENT] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Obtener resumen de pagos
exports.getBillingReport = async (req, res) => {
  try {
    const { month, year } = req.query;

    let query = db.collection('billing');
    if (month && year) {
      query = query.where('month', '==', parseInt(month))
        .where('year', '==', parseInt(year));
    }

    const billingSnapshot = await query.get();
    const payments = await db.collection('payments').get();

    const totalBilled = billingSnapshot.docs.reduce((sum, doc) => sum + doc.data().totalAmount, 0);
    const totalPaid = payments.docs.reduce((sum, doc) => sum + doc.data().amount, 0);

    const billings = billingSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      totalBilled,
      totalPaid,
      pending: totalBilled - totalPaid,
      billings,
      paymentCount: payments.size,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener factura específica
exports.getBillingById = async (req, res) => {
  try {
    const { billingId } = req.params;

    const billingDoc = await db.collection('billing').doc(billingId).get();
    if (!billingDoc.exists) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const billingData = billingDoc.data();
    const payments = await db.collection('payments')
      .where('billingId', '==', billingId)
      .get();

    return res.json({
      id: billingId,
      ...billingData,
      dueDate: toJsDate(billingData.dueDate),
      payments: payments.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        paidAt: toJsDate(doc.data().paidAt),
      })),
      totalPaid: payments.docs.reduce((sum, doc) => sum + doc.data().amount, 0),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener facturas con detalles completos (ADMIN ONLY) - Para mostrar en tabla con datos del estudiante
exports.getBillingWithDetails = async (req, res) => {
  try {
    const { status, month, year, studentId } = req.query;

    let query = db.collection('billing');
    
    if (status) {
      query = query.where('status', '==', status);
    }
    if (month && year) {
      query = query
        .where('month', '==', parseInt(month))
        .where('year', '==', parseInt(year));
    }
    if (studentId) {
      query = query.where('studentId', '==', studentId);
    }

    const billingSnapshot = await query.get();
    
    // Cargar estudiantes y cursos para enriquecer los datos
    const studentsSnapshot = await db.collection('students').get();
    const studentsMap = new Map();
    studentsSnapshot.docs.forEach(doc => {
      studentsMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    const coursesSnapshot = await db.collection('courses').get();
    const coursesMap = new Map();
    coursesSnapshot.docs.forEach(doc => {
      coursesMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    // Enriquecer facturas con datos del estudiante y curso
    const billings = billingSnapshot.docs.map((doc) => {
      const data = doc.data();
      const student = studentsMap.get(data.studentId) || {};
      const course = student.enrollment?.courseId ? coursesMap.get(student.enrollment.courseId) : null;

      return {
        id: doc.id,
        ...data,
        dueDate: toJsDate(data.dueDate),
        student: {
          id: data.studentId,
          name: `${(student.name || '').trim()} ${(student.lastName || '').trim()}`.trim() || 'N/A',
          email: student.email || 'N/A',
        },
        course: course ? {
          id: course.id,
          name: course.name || 'N/A',
          level: course.level || 'N/A',
        } : null,
        // Desglose de cargos por tipo (tuition, enrollment, material, uniform, activity, other)
        chargesByType: {
          tuition: data.charges?.filter(c => c.type === 'tuition') || [],
          enrollment: data.charges?.filter(c => c.type === 'enrollment') || [],
          materials: data.charges?.filter(c => c.type === 'material') || [],
          uniforms: data.charges?.filter(c => c.type === 'uniform') || [],
          activities: data.charges?.filter(c => c.type === 'activity') || [],
          other: data.charges?.filter(c => c.type === 'other') || [],
        },
        allCharges: data.charges || [],
        total: data.totalAmount || 0,
      };
    });

    billings.sort((a, b) => {
      const yDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yDiff !== 0) return yDiff;
      return (b.month ?? 0) - (a.month ?? 0);
    });

    return res.json({
      count: billings.length,
      billings,
    });
  } catch (error) {
    console.error('[BILLING] Error en getBillingWithDetails:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Actualizar status de factura manualmente (para ajustes)
exports.updateBillingStatus = async (req, res) => {
  try {
    const { billingId } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'paid', 'overdue', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const billingDoc = await db.collection('billing').doc(billingId).get();
    if (!billingDoc.exists) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const updateData = { status };
    if (status === 'paid' && !billingDoc.data().paidDate) {
      updateData.paidDate = new Date();
    }

    await db.collection('billing').doc(billingId).update(updateData);

    return res.json({
      message: `Factura actualizada a ${status}`,
      billingId,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ELIMINADO: updateBillingStatusForParent
// Los padres NO pueden cancelar, eliminar ni modificar facturas.
// Las facturas solo se manejan a través del admin.

// Helper para obtener todos los IDs de estudiantes asociados a un padre
async function getStudentIdsForParent(parentUid) {
  const studentIds = new Set();
  const parentDoc = await db.collection('usuarios').doc(parentUid).get();
  const parentData = parentDoc.exists ? parentDoc.data() : null;

  if (!parentData) {
    return [];
  }

  // Buscar por parentId
  const studentsByParentIdSnapshot = await db.collection('students')
    .where('parentId', '==', parentUid)
    .get();
  studentsByParentIdSnapshot.forEach(doc => studentIds.add(doc.id));

  // Buscar por parentEmail si existe
  if (parentData.email) {
    const studentsByParentEmailSnapshot = await db.collection('students')
      .where('parentEmail', '==', parentData.email)
      .get();
    studentsByParentEmailSnapshot.forEach(doc => studentIds.add(doc.id));
  }

  return [...studentIds];
}
