import { ROAD_MARKING_ARROW_IMAGES, ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE } from './roadMarkingConfig';

const ARROW_COLOR = 'rgba(248, 250, 252, 0.94)';
const ARROW_SHADOW = 'rgba(12, 24, 39, 0.34)';

export function addRoadMarkingImages(map) {
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through, drawThroughArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.left, (context, metrics) => drawTurnArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.right, (context, metrics) => drawTurnArrow(context, metrics, 'right'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through_left, (context, metrics) => drawForkArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through_right, (context, metrics) => drawForkArrow(context, metrics, 'right'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.left_right, drawLeftRightArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.u_turn, drawUTurnArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.slight_left, (context, metrics) => drawSlightArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.slight_right, (context, metrics) => drawSlightArrow(context, metrics, 'right'));
    addTrafficSignalImage(map);
}

function addTrafficSignalImage(map) {
    if (map.hasImage(ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE)) {
        return;
    }

    const width = 28;
    const height = 46;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(10, 19, 31, 0.76)';
    roundRect(context, 6, 2, 16, 36, 5);
    context.fill();

    drawSignalLamp(context, 14, 9, '#EF4444');
    drawSignalLamp(context, 14, 20, '#FBBF24');
    drawSignalLamp(context, 14, 31, '#22C55E');

    context.strokeStyle = 'rgba(237, 244, 251, 0.68)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(14, 38);
    context.lineTo(14, 44);
    context.stroke();

    map.addImage(ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE, context.getImageData(0, 0, width, height), { pixelRatio: 2 });
}

function drawSignalLamp(context, x, y, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 3.1, 0, Math.PI * 2);
    context.fill();
}

function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function addArrowImage(map, id, draw) {
    if (map.hasImage(id)) {
        return;
    }

    const width = 92;
    const height = 138;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.clearRect(0, 0, width, height);
    draw(context, { width, height, centerX: width / 2, baseY: 112, headY: 25 });

    map.addImage(id, context.getImageData(0, 0, width, height), { pixelRatio: 2 });
}

function setupPaint(context, shadow = false) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = shadow ? ARROW_SHADOW : ARROW_COLOR;
    context.fillStyle = shadow ? ARROW_SHADOW : ARROW_COLOR;
}

function drawArrowHead(context, x, y, angle, size) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size * 0.64, size * 0.62);
    context.lineTo(0, size * 0.2);
    context.lineTo(-size * 0.64, size * 0.62);
    context.closePath();
    context.fill();
    context.restore();
}

function drawPathWithShadow(context, drawPath, width = 8) {
    setupPaint(context, true);
    context.lineWidth = width + 3;
    drawPath();
    context.stroke();

    setupPaint(context);
    context.lineWidth = width;
    drawPath();
    context.stroke();
}

function drawThroughArrow(context, { centerX, baseY = 88, headY = 21 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, headY + 6);
    });
    setupPaint(context, true);
    drawArrowHead(context, centerX, headY, 0, 18);
    setupPaint(context);
    drawArrowHead(context, centerX, headY, 0, 18);
}

function drawTurnArrow(context, { centerX, baseY = 88, headY = 25 }, side) {
    const sign = side === 'left' ? -1 : 1;
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 68);
        context.quadraticCurveTo(centerX, 38, centerX + sign * 31, 37);
    });
    setupPaint(context, true);
    drawArrowHead(context, centerX + sign * 37, 37, sign * Math.PI / 2, 16);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 37, 37, sign * Math.PI / 2, 16);
}

function drawForkArrow(context, metrics, side) {
    const { centerX } = metrics;
    const sign = side === 'left' ? -1 : 1;
    drawThroughArrow(context, metrics);
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, 78);
        context.quadraticCurveTo(centerX + sign * 4, 48, centerX + sign * 34, 39);
    }, 7);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 39, 37, sign * Math.PI / 2.6, 15);
}

function drawLeftRightArrow(context, { centerX, baseY = 88 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 72);
        context.moveTo(centerX, 72);
        context.quadraticCurveTo(centerX - 5, 42, centerX - 35, 39);
        context.moveTo(centerX, 72);
        context.quadraticCurveTo(centerX + 5, 42, centerX + 35, 39);
    }, 7);
    setupPaint(context, true);
    drawArrowHead(context, centerX - 40, 39, -Math.PI / 2, 15);
    drawArrowHead(context, centerX + 40, 39, Math.PI / 2, 15);
    setupPaint(context);
    drawArrowHead(context, centerX - 40, 39, -Math.PI / 2, 15);
    drawArrowHead(context, centerX + 40, 39, Math.PI / 2, 15);
}

function drawUTurnArrow(context, { centerX, baseY = 88 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX + 16, baseY);
        context.lineTo(centerX + 16, 52);
        context.quadraticCurveTo(centerX + 16, 28, centerX - 10, 28);
        context.quadraticCurveTo(centerX - 34, 28, centerX - 34, 52);
        context.lineTo(centerX - 34, 69);
    }, 7);
    setupPaint(context);
    drawArrowHead(context, centerX - 34, 74, Math.PI, 15);
}

function drawSlightArrow(context, { centerX, baseY = 88 }, side) {
    const sign = side === 'left' ? -1 : 1;
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 74);
        context.quadraticCurveTo(centerX, 48, centerX + sign * 24, 31);
    }, 7);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 29, 27, sign * Math.PI / 5, 16);
}
