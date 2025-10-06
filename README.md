# 🎓 DuoPlanner

**DuoPlanner** es una aplicación web académica diseñada para estudiantes universitarios que buscan **organizar su vida académica de forma inteligente, visual y colaborativa**.  
Permite gestionar semestres, notas, asistencia, horarios, progreso y trabajar en conjunto con un compañero (“Duo”) para comparar avances y rendimiento.

---

## 🧠 Descripción general

DuoPlanner combina herramientas de planificación académica, análisis de progreso y colaboración social.  
Su interfaz moderna, desarrollada en **HTML, CSS y JavaScript**, ofrece una experiencia fluida y atractiva, con sincronización en la nube mediante Firebase y capacidades de inteligencia artificial a través de OpenAI.

El objetivo principal del sistema es **centralizar toda la información universitaria del estudiante** en una sola plataforma, ofreciendo además interacción con un asistente virtual que responde preguntas sobre el perfil, ramos, notas y mucho más.

---

## 💡 Objetivos

- Facilitar la **organización académica** de los estudiantes.  
- Permitir una **gestión visual** de los semestres y ramos cursados.  
- Ofrecer una experiencia **colaborativa** entre compañeros (“Duo”).  
- Incorporar un **asistente inteligente** capaz de responder preguntas y ejecutar acciones académicas.  

---

## ✨ Funcionalidades principales

### 🧍‍♂️ Perfil
- Gestión del **nombre, correo, fecha de nacimiento, universidad, carrera y color favorito**.  
- Subida de **foto o avatar** (con imagen predeterminada por defecto).  
- Opción de **eliminar o cambiar el avatar**.  
- Sincronización del perfil con la nube (Firebase).  
- Configuración visual y personal del tema.  
- **Asistente AI** capaz de responder preguntas como:
  - “¿Cuál es mi universidad?”
  - “¿Cómo cambio mi color favorito?”
  - “¿Cuántos años tengo?”
  - “¿Cuál es mi correo universitario?”
  - “¿Cómo cambio mi número de teléfono?”
- Soporte para **consultar información del Duo** (compañero académico) como su nombre, carrera, color favorito o cumpleaños.  

---

### 📚 Semestres
- Creación y gestión de **semestres académicos** (por ejemplo, “2025-1”, “2025-2”).  
- Asociación automática con la universidad definida en el perfil.  
- Añadir, editar o eliminar **ramos** dentro de cada semestre.  
- Configurar cada ramo con:
  - Nombre, código, profesor, color, sección y asistencia.  
- El asistente puede responder:
  - “¿Cuántos ramos tengo este semestre?”
  - “¿Cuál es el código del ramo X?”
  - “¿Qué ramos tienen asistencia obligatoria?”
- Vista compartida del **semestre del Duo**.  

---

### 📊 Notas
- Agregar y editar **evaluaciones** (Certámenes, Tareas, Laboratorios, etc.).  
- Definir **fórmulas personalizadas** para calcular el promedio final, incluyendo:
  - Operaciones con porcentajes, sumas y ponderaciones.
  - Uso de notas finales de otros ramos con `finalCode("CODIGO")` o `final("Nombre")`.
- Simulador de notas avanzado:
  - Permite simular posibles promedios.
  - Indica qué necesitas para aprobar.
- Visualización clara del **estado del ramo**:
  - Promedio actual
  - Nota mínima para aprobar
  - Estado de aprobación
- Soporte para comparar notas con el Duo.  

---

### 🗺️ Malla curricular
- Visualización completa de la **malla de tu carrera** a partir de archivos CSV.  
- Muestra prerrequisitos, semestres y asignaturas.  
- Diseño modular y cuadrado, optimizado para la lectura y distribución por año.  
- Opción para **exportar la malla como imagen o PDF**.  

---

### 🏁 Progreso
- Cálculo automático del avance en la carrera (asignaturas aprobadas, en curso, pendientes).  
- Comparación de progreso individual y con el Duo.  
- Visualización mediante barras y estadísticas dinámicas.  

---

### 📅 Horario
- Creador de horario con vista semanal.  
- Diferenciación por color y nombre de ramo.  
- Exportación del horario a **imagen o PDF**.  
- Posibilidad de ver el **horario del Duo**.  

---

### 📋 Asistencia
- Registro de asistencia por ramo.  
- Marcado rápido de **Presente**, **Ausente** o **No hubo clase**.  
- Registro visual y exportable.  

---

### 🎉 Party (modo Duo)
- Sistema de emparejamiento (“Party”) para conectar dos estudiantes.  
- Generación de un **ID único** para compartir.  
- Comparación de semestres, notas, y progreso con tu compañero.  
- Opción de **salir del Duo** o **eliminar la Party**.  

---

### 🆘 Centro de Ayuda
- Pestaña dedicada con comandos organizados por secciones:  
  - **Perfil**, **Semestres**, **Notas**, **Malla**, **Horario**, **Asistencia**, **Party**.  
- Cada sección está subdividida en:
  - **Usuario** → Preguntas personales.
  - **Duo** → Preguntas sobre el compañero.
  - **Acciones** → Tareas que el bot puede ejecutar por ti.
- Interfaz interactiva mediante menús expandibles (`<details>` y `<summary>`).  

---

## ⚙️ Tecnologías utilizadas

| Área | Tecnologías |
|------|--------------|
| **Frontend** | HTML5, CSS3 (con gradientes, variables y animaciones), JavaScript ES6 |
| **Backend** | Node.js (Vercel), Firebase Admin SDK |
| **IA / NLU** | OpenAI API (GPT-4o-mini) |
| **Base de datos** | Firestore (Firebase) |
| **Control de versiones** | Git & GitHub |
| **Exportaciones** | html2canvas, jsPDF |

---

## 🚧 Mejoras futuras

- Permitir emparejamientos entre más de dos usuarios.  
- Posibilidad de **crear una malla personalizada** directamente desde la página.  
- Implementar las capacidades del **bot inteligente en todas las pestañas**.  
- Mejorar la **adaptabilidad del diseño** para distintos dispositivos y resoluciones.  
- Convertir DuoPlanner en una **aplicación móvil**, con notificaciones para recordatorios de clases o evaluaciones.

---

## 👥 Autor

Proyecto desarrollado por **Jean Alexandre Vergara**  
Universidad Técnica Federico Santa María  
📧 [jean.vergara@usm.cl](mailto:jean.alexandre@usm.cl)

---


⭐ *Si te gustó el proyecto, considera dejar una estrella en GitHub :)*
