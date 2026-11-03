# ggplot2 reference: geom_boxplot — notch, varwidth, fixed fill, outlier look
p <- ggplot(mpg, aes(class, hwy))
p + geom_boxplot(notch = TRUE, varwidth = TRUE, fill = "white", colour = "#3366FF",
                 outlier.colour = "red", outlier.shape = 1)
