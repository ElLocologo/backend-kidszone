const { db } = require('../config/firebase');
const { getRole, getName } = require('../utils/userCompat');

/**
 * Crear relación padre-hijo
 * POST /api/parent-associations
 * Body: { parentId, studentId, relationship }
 * relationship: "Padre", "Madre", "Tutor"
 */
exports.createParentAssociation = async (req, res) => {
  try {
    const { parentId, studentId, relationship } = req.body;

    // Validaciones
    if (!parentId || !studentId || !relationship) {
      return res.status(400).json({
        error: 'parentId, studentId y relationship son requeridos'
      });
    }

    const validRelationships = ['Padre', 'Madre', 'Tutor', 'Padrastro', 'Madrastra', 'Abuelo', 'Abuela'];
    if (!validRelationships.includes(relationship)) {
      return res.status(400).json({
        error: `relationship debe ser uno de: ${validRelationships.join(', ')}`
      });
    }

    // Verificar que el padre existe
    const parentDoc = await db.collection('usuarios').doc(parentId).get();
    if (!parentDoc.exists || getRole(parentDoc.data()) !== 'parent') {
      return res.status(404).json({ error: 'Padre no encontrado o no tiene rol de padre' });
    }

    // Verificar que el estudiante existe
    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const parent = parentDoc.data();
    const student = studentDoc.data();

    // Buscar si ya existe asociación
    const existing = await db.collection('parentAssociations')
      .where('parentId', '==', parentId)
      .where('studentIds', 'array-contains', studentId)
      .get();

    if (!existing.empty) {
      return res.status(400).json({
        error: 'Esta relación padre-hijo ya existe'
      });
    }

    // Crear nueva asociación
    const assocRef = db.collection('parentAssociations').doc();
    const association = {
      id: assocRef.id,
      parentId,
      parentEmail: parent.email,
      studentIds: [studentId],
      relationships: [
        {
          studentId,
          studentName: `${student.name} ${student.lastName}`,
          relationship
        }
      ],
      isActive: true,
      createdAt: new Date()
    };

    await assocRef.set(association);

    console.log(`[PARENT ASSOCIATION] Creada: ${parentId} → ${studentId}`);

    return res.status(201).json({
      message: 'Relación padre-hijo creada exitosamente',
      association: {
        id: assocRef.id,
        ...association
      }
    });
  } catch (error) {
    console.error('[PARENT ASSOCIATION CREATE] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener todos los hijos de un padre
 * GET /api/parents/:parentId/children
 */
exports.getParentChildren = async (req, res) => {
  try {
    const { parentId } = req.params;

    // Verificar que el padre existe
    const parentDoc = await db.collection('usuarios').doc(parentId).get();
    if (!parentDoc.exists) {
      return res.status(404).json({ error: 'Padre no encontrado' });
    }

    // Obtener asociaciones
    const snapshot = await db.collection('parentAssociations')
      .where('parentId', '==', parentId)
      .where('isActive', '==', true)
      .get();

    let allChildren = [];

    // Para cada asociación, obtener los estudiantes
    for (const doc of snapshot.docs) {
      const assoc = doc.data();
      const studentIds = assoc.studentIds || [];

      for (const studentId of studentIds) {
        const studentDoc = await db.collection('students').doc(studentId).get();
        if (studentDoc.exists) {
          allChildren.push({
            id: studentDoc.id,
            ...studentDoc.data(),
            // Agregar la relación específica
            relationshipToParent: assoc.relationships?.find(r => r.studentId === studentId)?.relationship || 'Padre'
          });
        }
      }
    }

    return res.status(200).json({
      parentId,
      childrenCount: allChildren.length,
      children: allChildren
    });
  } catch (error) {
    console.error('[PARENT GET CHILDREN] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Obtener todos los padres de un estudiante
 * GET /api/students/:studentId/parents
 */
exports.getStudentParents = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Verificar que el estudiante existe
    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    // Obtener asociaciones
    const snapshot = await db.collection('parentAssociations')
      .where('studentIds', 'array-contains', studentId)
      .where('isActive', '==', true)
      .get();

    let allParents = [];

    // Para cada asociación, obtener el padre
    for (const doc of snapshot.docs) {
      const assoc = doc.data();
      const parentDoc = await db.collection('usuarios').doc(assoc.parentId).get();

      if (parentDoc.exists) {
        const relationshipData = assoc.relationships?.find(r => r.studentId === studentId) || {};

        allParents.push({
          id: parentDoc.id,
          email: parentDoc.data().email,
          name: getName(parentDoc.data()) || '',
          phone: parentDoc.data().phone || '',
          relationship: relationshipData.relationship || 'Padre'
        });
      }
    }

    return res.status(200).json({
      studentId,
      parentsCount: allParents.length,
      parents: allParents
    });
  } catch (error) {
    console.error('[STUDENT GET PARENTS] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Agregar otro hijo a asociación existente
 * POST /api/parent-associations/:associationId/add-child
 * Body: { studentId, relationship }
 */
exports.addChildToAssociation = async (req, res) => {
  try {
    const { associationId } = req.params;
    const { studentId, relationship } = req.body;

    if (!studentId || !relationship) {
      return res.status(400).json({
        error: 'studentId y relationship son requeridos'
      });
    }

    // Verificar que la asociación existe
    const assocDoc = await db.collection('parentAssociations').doc(associationId).get();
    if (!assocDoc.exists) {
      return res.status(404).json({ error: 'Asociación no encontrada' });
    }

    // Verificar que el estudiante existe
    const studentDoc = await db.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    const assoc = assocDoc.data();
    const student = studentDoc.data();

    // Verificar que no esté duplicado
    if (assoc.studentIds.includes(studentId)) {
      return res.status(400).json({
        error: 'Este estudiante ya está asociado a este padre'
      });
    }

    // Agregar estudiante
    const newStudentIds = [...assoc.studentIds, studentId];
    const newRelationships = [
      ...(assoc.relationships || []),
      {
        studentId,
        studentName: `${student.name} ${student.lastName}`,
        relationship
      }
    ];

    await db.collection('parentAssociations').doc(associationId).update({
      'studentIds': newStudentIds,
      'relationships': newRelationships
    });

    console.log(`[PARENT ASSOCIATION] Estudiante agregado: ${studentId} a asociación ${associationId}`);

    return res.status(200).json({
      message: 'Estudiante agregado exitosamente',
      associationId,
      studentId
    });
  } catch (error) {
    console.error('[PARENT ASSOCIATION ADD CHILD] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Desactivar relación padre-hijo
 * DELETE /api/parent-associations/:associationId/children/:studentId
 */
exports.removeChildFromAssociation = async (req, res) => {
  try {
    const { associationId, studentId } = req.params;

    // Verificar que la asociación existe
    const assocDoc = await db.collection('parentAssociations').doc(associationId).get();
    if (!assocDoc.exists) {
      return res.status(404).json({ error: 'Asociación no encontrada' });
    }

    const assoc = assocDoc.data();

    // Remover estudiante
    const newStudentIds = assoc.studentIds.filter(id => id !== studentId);
    const newRelationships = (assoc.relationships || []).filter(r => r.studentId !== studentId);

    // Si no hay más estudiantes, desactivar la asociación
    if (newStudentIds.length === 0) {
      await db.collection('parentAssociations').doc(associationId).update({
        'isActive': false
      });
    } else {
      await db.collection('parentAssociations').doc(associationId).update({
        'studentIds': newStudentIds,
        'relationships': newRelationships
      });
    }

    console.log(`[PARENT ASSOCIATION] Estudiante removido: ${studentId} de asociación ${associationId}`);

    return res.status(200).json({
      message: 'Relación removida exitosamente',
      associationId,
      studentId
    });
  } catch (error) {
    console.error('[PARENT ASSOCIATION REMOVE CHILD] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
