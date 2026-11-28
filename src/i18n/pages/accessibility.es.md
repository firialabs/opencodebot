# Declaración de accesibilidad

*3 de diciembre de 2026*

*Esta traducción se hizo por máquina y aún no la ha revisado una persona. Si hay alguna
diferencia, rige la [versión en inglés](index.html).*

Firia Labs quiere que todos los estudiantes puedan programar con {app}, incluidos los que usan el
teclado en lugar del mouse, un lector de pantalla, alto contraste o movimiento reducido.

## Nuestra meta

{app} busca cumplir las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1, nivel AA.

## Cómo lo comprobamos

Cada cambio a {app} se prueba automáticamente antes de llegar al sitio, entre otras cosas con:

- **Una revisión automática de WCAG 2.1 A y AA** (axe-core) en las pantallas que usan estudiantes y
  maestros: la pantalla principal, conectar una placa y ejecutar un programa, el editor de Python y
  su paleta, el explorador de archivos, los menús, el panel Aprender, el tutorial de misiones y sus
  cuestionarios, Ayuda, Acerca de, y el simulador, en marcha y en pausa. Esta página y la política de
  privacidad también se revisan.
- **Recorridos con teclado**: los menús se abren y se cierran con el teclado y devuelven el foco a
  donde estaba; se puede agregar un bloque desde la paleta solo con el teclado; Ejecutar, Detener,
  Pausa y Paso se pasan el teclado entre sí; los divisores y la terminal cambian de tamaño con las
  flechas.
- **Contraste**: el texto sobre cada color de bloque cumple 4.5:1.
- **Movimiento reducido**: cuando la computadora pide menos movimiento, las animaciones se apagan.
- **Cada palabra que muestra la aplicación viene de una sola tabla**, así que se puede traducir y
  leer en voz alta de forma coherente (hoy en inglés y español).

## Lo que funciona bien

- La **vista de Python** muestra el mismo programa que los bloques, y es un editor de texto completo
  que funciona por completo con el teclado y con lectores de pantalla. Un estudiante puede cambiar
  entre bloques y Python en cualquier momento sin perder nada.
- El **simulador se describe con palabras** para los lectores de pantalla: una descripción de la
  placa, siempre al día, y avisos breves cuando algo cambia (empezó o dejó de moverse, chocó con
  algo, despegó, aterrizó).
- La línea de estado y los avisos se anuncian al aparecer.

## Límites conocidos

- **Mover bloques con el teclado** funciona (Ayuda muestra las teclas), pero toma más pasos que con
  un mouse o una pantalla táctil. La vista de Python es la forma más rápida de escribir y cambiar un
  programa con el teclado.
- **La imagen 3D del simulador** es visual; su descripción con palabras cubre lo que hace la placa,
  no cada detalle de la sala.
- La traducción al español se hizo por máquina y aún no la ha revisado un hablante nativo.
- Conectar una placa necesita Chrome o Edge en una computadora o Chromebook (Web Serial). El
  simulador funciona en las versiones actuales de Chrome, Edge, Safari y Firefox.

## Cuéntanos

Si algo en {app} te resulta difícil o imposible de usar, a ti o a un estudiante, por favor dinos:
[support@firialabs.com](mailto:support@firialabs.com), o repórtalo en [GitHub]({issues}). Leemos
cada reporte y respondemos en pocos días hábiles.
